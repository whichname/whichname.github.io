---
title: Logan 源码解析（上） - Android
tags: ["android-source"]
key: Logan-Android
---

本文对美团开源的日志 sdk `Logan` 进行源码分析，涉及 `Android ` 和 `Native` 两部分。

由于篇幅问题，会将这两部分拆成两篇文章，本篇为 `Android` 端的解析。

<!--more-->

项目地址：[https://github.com/Meituan-Dianping/Logan](https://github.com/Meituan-Dianping/Logan)

## 使用

```kotlin
val config = LoganConfig.Builder()
    .setCachePath(applicationContext.filesDir.absolutePath)
    .setPath(
        (applicationContext.getExternalFilesDir(null).absolutePath
                + File.separator) + "logan_v1"
    )
    .setEncryptKey16("0123456789012345".toByteArray())
    .setEncryptIV16("0123456789012345".toByteArray())
    .build()
// 初始化    
Logan.init(config)
// 写日志
Logan.w("test logan", 1)
// flush
Logan.f()
// 自定义上传，也有自带上传功能，不过需要配合他的服务端
Logan.s(Logan.getAllFilesInfo().keys.toTypedArray(), object : SendLogRunnable() {
    override fun sendLog(logFile: File?) {
        // TODO upload....
        finish()
        logFile?.name?.run {
            if(this.contains(".copy")) {
                logFile.delete()
            }
        }
    }
})
```

## Android

- Logan.java: 入口类，调用 `LoganControlCenter`
- LoganControlCenter.java: 单例，开启 `LoganThread` 线程、封装 `LoganModel` 发送到队列 `mCacheLogQueue`
- LoganThread.java: 线程类，初始化 `LoganProtocol`、不断从队列中获取 `LoganModel` 调用 `LoganProtocol `进行相应的读、`flush`、上传等动作
- LoganProtocolHandler.java: 定义初始化、读、`flush`、上传等接口
- LoganProtocol.java: 单例， `LoganProtocolHandler` 实现类，持有 `CLoganProtocol` 实例
- CLoganProtocol.java: jni 类，调用 native `CLogan`

### 初始化

初始化时会启动 `LoganThread` 线程，该线程从队列中不断取得下一次的动作，比如写、上传等；

在取得动作的时候，如果 `LoganProtocol` 未初始化，就会初始化 `LoganProtocol`，一直调用到 native 层的 `clogan_init` 方法。

#### Logan.java

```java
public class Logan {
 
    public static void init(LoganConfig loganConfig) {
        // 单例
        sLoganControlCenter = LoganControlCenter.instance(loganConfig);
    }  
  
}
```

#### LoganControlCenter.java

```java
class LoganControlCenter {
  
    private LoganControlCenter(LoganConfig config) {
        ...
        init();
    }  
  
    private void init() {
        if (mLoganThread == null) {
            mLoganThread = new LoganThread(mCacheLogQueue, mCachePath, mPath, mSaveTime,
                    mMaxLogFile, mMinSDCard, mEncryptKey16, mEncryptIv16);
            mLoganThread.setName("logan-thread");
            mLoganThread.start();
        }
    }  
  
}
```

#### LoganThread.java

```java
class LoganThread extends Thread {
  
    @Override
    public void run() {
        super.run();
        while (mIsRun) {
            synchronized (sync) {
                mIsWorking = true;
                try {
                    // 从队列中取动作
                    LoganModel model = mCacheLogQueue.poll();
                    if (model == null) {
                        mIsWorking = false;
                        // 等待
                        sync.wait();
                        mIsWorking = true;
                    } else {
                        // 执行
                        action(model);
                    }
                } catch (InterruptedException e) {
                    e.printStackTrace();
                    mIsWorking = false;
                }
            }
        }
    }  
  
    private void action(LoganModel model) {
        ...
        if (mLoganProtocol == null) {
            // 初始化, 单例
            mLoganProtocol = LoganProtocol.newInstance();
            mLoganProtocol.setOnLoganProtocolStatus(new OnLoganProtocolStatus() {
                @Override
                public void loganProtocolStatus(String cmd, int code) {
                    Logan.onListenerLogWriteStatus(cmd, code);
                }
            });
            mLoganProtocol.logan_init(mCachePath, mPath, (int) mMaxLogFile, mEncryptKey16,
                    mEncryptIv16);
            mLoganProtocol.logan_debug(Logan.sDebug);
        }
        ...
    }  
  
}
```

#### LoganProtocol.java

```java
class LoganProtocol implements LoganProtocolHandler {

    @Override
    public void logan_init(String cache_path, String dir_path, int max_file, String encrypt_key_16,
            String encrypt_iv_16) {
        if (mIsInit) {
            return;
        }
        if (CLoganProtocol.isCloganSuccess()) {
            // 初始化，单例
            mCurProtocol = CLoganProtocol.newInstance();
            mCurProtocol.setOnLoganProtocolStatus(mLoganProtocolStatus);
            mCurProtocol.logan_init(cache_path, dir_path, max_file, encrypt_key_16, encrypt_iv_16);
            mIsInit = true;
        } else {
            mCurProtocol = null;
        }
    }
  
}
```

#### CLoganProtocol.java

```java
class CLoganProtocol implements LoganProtocolHandler {
  
    private native int clogan_init(String cache_path, String dir_path, int max_file,
            String encrypt_key_16, String encrypt_iv_16);  
  
}
```

### 写日志

写日志时，先将数据封装成 `LoganModel` ，然后塞入队列中；

`LoganThread` 会从队列中取到该 `LoganModel`，然后进入写逻辑；

写逻辑中，会判断是否需要清除过期文件、打开新日志文件（日期变了）、判断SDCard 是否可以写入、日志文件是否达到了限制大小（是的话不写入），最后执行到 native 层的写入方法。

#### Logan.java

```java
public class Logan {
 
    public static void w(String log, int type) {
        if (sLoganControlCenter == null) {
            throw new RuntimeException("Please initialize Logan first");
        }
        sLoganControlCenter.write(log, type);
    }
  
}
```

#### LoganControlCenter.java

```java
class LoganControlCenter {
  
    void write(String log, int flag) {
        if (TextUtils.isEmpty(log)) {
            return;
        }
        // 封装 LoganModel
        LoganModel model = new LoganModel();
        model.action = LoganModel.Action.WRITE;
        WriteAction action = new WriteAction();
        ...
        model.writeAction = action;
        if (mCacheLogQueue.size() < mMaxQueue) {
            // 塞入队列
            mCacheLogQueue.add(model);
            if (mLoganThread != null) {
                mLoganThread.notifyRun();
            }
        }
    } 
  
}
```

#### LoganThread.java

```java
class LoganThread extends Thread {
  
    private void action(LoganModel model) {
        ...
        if (model.action == LoganModel.Action.WRITE) {
            doWriteLog2File(model.writeAction);
        }
        ...
    }  
  
    private void doWriteLog2File(WriteAction action) {
        if (Logan.sDebug) {
            Log.d(TAG, "Logan write start");
        }
        if (mFileDirectory == null) {
            mFileDirectory = new File(mPath);
        }

        // 是否跟上次写日志时间同一天，不同的话删除过期日志、新开当天的日志文件
        if (!isDay()) {
            long tempCurrentDay = Util.getCurrentTime();
            long deleteTime = tempCurrentDay - mSaveTime;
            deleteExpiredFile(deleteTime);
            mCurrentDay = tempCurrentDay;
            mLoganProtocol.logan_open(String.valueOf(mCurrentDay));
        }

        //每隔1分钟判断一次 sdcard 是否可以写
        long currentTime = System.currentTimeMillis(); 
        if (currentTime - mLastTime > MINUTE) {
            mIsSDCard = isCanWriteSDCard();
        }
        mLastTime = System.currentTimeMillis();

        //如果大于50M 不让再次写入
        if (!mIsSDCard) { 
            return;
        }
        // 写
        mLoganProtocol.logan_write(action.flag, action.log, action.localTime, action.threadName,
                action.threadId, action.isMainThread);
    }  
  
}
```

#### LoganProtocol.java

```java
class LoganProtocol implements LoganProtocolHandler {

    @Override
    public void logan_open(String file_name) {
        if (mCurProtocol != null) {
            mCurProtocol.logan_open(file_name);
        }
    }  
  
    @Override
    public void logan_write(int flag, String log, long local_time, String thread_name,
            long thread_id, boolean is_main) {
        if (mCurProtocol != null) {
            // mCurProtocol 就是 CLoganProtocol
            mCurProtocol.logan_write(flag, log, local_time, thread_name, thread_id,
                    is_main);
        }
    }  
  
}
```

#### CLoganProtocol.java

```java
class CLoganProtocol implements LoganProtocolHandler {

    @Override
    public void logan_open(String file_name) {
        if (!mIsLoganInit || !sIsCloganOk) {
            return;
        }
        try {
            int code = clogan_open(file_name);
            mIsLoganOpen = true;
            loganStatusCode(ConstantCode.CloganStatus.CLOGAN_OPEN_STATUS, code);
        } catch (UnsatisfiedLinkError e) {
            e.printStackTrace();
            loganStatusCode(ConstantCode.CloganStatus.CLOGAN_OPEN_STATUS,
                    ConstantCode.CloganStatus.CLOGAN_OPEN_FAIL_JNI);
        }
    }  
  
    @Override
    public void logan_write(int flag, String log, long local_time, String thread_name,
            long thread_id, boolean is_main) {
        if (!mIsLoganOpen || !sIsCloganOk) {
            return;
        }
        try {
            int isMain = is_main ? 1 : 0;
            int code = clogan_write(flag, log, local_time, thread_name, thread_id,
                    isMain);
            if (code != ConstantCode.CloganStatus.CLOGAN_WRITE_SUCCESS || Logan.sDebug) {
                loganStatusCode(ConstantCode.CloganStatus.CLOGAN_WRITE_STATUS, code);
            }
        } catch (UnsatisfiedLinkError e) {
            e.printStackTrace();
            loganStatusCode(ConstantCode.CloganStatus.CLOGAN_WRITE_STATUS,
                    ConstantCode.CloganStatus.CLOGAN_WRITE_FAIL_JNI);
        }
    }  
  
    private native int clogan_open(String file_name);  
  
    private native int clogan_write(int flag, String log, long local_time, String thread_name,
            long thread_id, int is_main);
  
}
```

### 上传

上传不是 `CLogan` 的实现，而是在 `Android` 端实现的；

传入要上传的日志日期数组（`Logan` 的日志是按 `yyyy-MM-dd` 来保存的） 和 实际的上传动作 `SendLogRunnable` ，依然会包装成 `LoganModel` 塞入队列中；

`LoganThread` 取到第一个上传的 `LoganModel`，会使用单线程的线程池，执行对应的 `SendLogRunnable`；

在上传过程中，如果 `LoganThread` 又取到了新的上传 `LoganModel`，会将其缓存到另一个队列中；待正在上传的 `LoganModel` 上传完成后，再将该队列全部加入到 `LoganModel` 队列中；

上传完成，并不会自动删除日志文件。

#### Logan.java

```java
public class Logan {
  
    /**
     * @param dates    日期数组，格式：“2018-07-27”
     * @param runnable 发送操作
     * @brief 发送日志
     */
    public static void s(String[] dates, SendLogRunnable runnable) {
        if (sLoganControlCenter == null) {
            throw new RuntimeException("Please initialize Logan first");
        }
        sLoganControlCenter.send(dates, runnable);
    }
  
}
```

#### LoganControlCenter.java

```java
class LoganControlCenter {

    void send(String dates[], SendLogRunnable runnable) {
        if (TextUtils.isEmpty(mPath) || dates == null || dates.length == 0) {
            return;
        }
        for (String date : dates) {
            if (TextUtils.isEmpty(date)) {
                continue;
            }
            long time = getDateTime(date);
            if (time > 0) {
                LoganModel model = new LoganModel();
                SendAction action = new SendAction();
                model.action = LoganModel.Action.SEND;
                action.date = String.valueOf(time);
                action.sendLogRunnable = runnable;
                model.sendAction = action;
                mCacheLogQueue.add(model);
                if (mLoganThread != null) {
                    mLoganThread.notifyRun();
                }
            }
        }
    }
  
}
```

#### LoganThread.java

```java
class LoganThread extends Thread {
  
    private void action(LoganModel model) {
        ...
        else if (model.action == LoganModel.Action.SEND) {
            if (model.sendAction.sendLogRunnable != null) {
                // 是否正在发送
                synchronized (sendSync) {
                    // 正在发送的话，将 model 加入 mCacheSendQueue 队列
                    // 每次只执行一个上传 model
                    if (mSendLogStatusCode == SendLogRunnable.SENDING) {
                        mCacheSendQueue.add(model);
                    } else {
                        doSendLog2Net(model.sendAction);
                    }
                }
            }
        }
        ...
    }  
  
    private void doSendLog2Net(SendAction action) {
        if (Logan.sDebug) {
            Log.d(TAG, "Logan send start");
        }
        if (TextUtils.isEmpty(mPath) || action == null || !action.isValid()) {
            return;
        }
        boolean success = prepareLogFile(action);
        if (!success) {
            if (Logan.sDebug) {
                Log.d(TAG, "Logan prepare log file failed, can't find log file");
            }
            return;
        }
        action.sendLogRunnable.setSendAction(action);
        action.sendLogRunnable.setCallBackListener(
                new SendLogRunnable.OnSendLogCallBackListener() {
                    @Override
                    public void onCallBack(int statusCode) {
                        synchronized (sendSync) {
                            mSendLogStatusCode = statusCode;
                            // 上传完成，将缓存的 model 重新加入到 mCacheLogQueue 队列中，开启下一个上传
                            if (statusCode == SendLogRunnable.FINISH) {
                                mCacheLogQueue.addAll(mCacheSendQueue);
                                mCacheSendQueue.clear();
                                notifyRun();
                            }
                        }
                    }
                });
        mSendLogStatusCode = SendLogRunnable.SENDING;
        // 使用单线程的线程池进行上传
        if (mSingleThreadExecutor == null) {
            mSingleThreadExecutor = Executors.newSingleThreadExecutor(new ThreadFactory() {
                @Override
                public Thread newThread(Runnable r) {
                    // Just rename Thread
                    Thread t = new Thread(Thread.currentThread().getThreadGroup(), r,
                            "logan-thread-send-log", 0);
                    if (t.isDaemon()) {
                        t.setDaemon(false);
                    }
                    if (t.getPriority() != Thread.NORM_PRIORITY) {
                        t.setPriority(Thread.NORM_PRIORITY);
                    }
                    return t;
                }
            });
        }
        mSingleThreadExecutor.execute(action.sendLogRunnable);
    } 
  
    /**
     * 发送日志前的预处理操作
     */
    private boolean prepareLogFile(SendAction action) {
        if (Logan.sDebug) {
            Log.d(TAG, "prepare log file");
        }
        if (isFile(action.date)) { //是否有日期文件
            String src = mPath + File.separator + action.date;
            // 上传当天日志，拷贝一份用来上传，否则上传源文件
            if (action.date.equals(String.valueOf(Util.getCurrentTime()))) {
                doFlushLog2File();
                String des = mPath + File.separator + action.date + ".copy";
                if (copyFile(src, des)) {
                    action.uploadPath = des;
                    return true;
                }
            } else {
                action.uploadPath = src;
                return true;
            }
        } else {
            action.uploadPath = "";
        }
        return false;
    }  
  
}
```





