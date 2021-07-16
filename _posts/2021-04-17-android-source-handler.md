---
title: Handler 源码解析
tags: ["android-source"]
key: handler
---

## 初始化

### Looper、MessageQueue 初始化

1. 先调用 Looper.prepare()，会创建 Looper 实例放入 ThreadLocal 中
2. Looper 的构造函数会创建消息队列 MessageQueue
3. MessageQueue 的构造函数会通过 nativeInit 调用到 native 层
4. nativeInit 方法会创建 native 层的消息队列 NativeMessageQueue
5. NativeMessageQueue 的构造函数会创建 native 层的 Looper，放入线程中（pthread_setspecific）
6. Looper 的构造函数会创建 eventfd，然后调用 rebuildEpollLocked 方法创建 epoll 实例
7. rebuildEpollLocked 方法会调用 epoll_create1、epoll_ctl 创建 epoll 实例并添加 eventfd 的可读事件

> 在 android 6.0 前，native 的 Looper 使用的是匿名管道 pipe，pipe 会创建两个虚拟文件，一个用来读一个用来写；6.0 开始，Looper 改成了 eventfd ， 只会创建一个虚拟文件，而且性能更好

<!--more-->

#### Looper.java

```java
// quitAllowed: 是否可以退出, MainLooper 的时候是 false, 其他时候是 true
private static void prepare(boolean quitAllowed) {
    if (sThreadLocal.get() != null) {
        throw new RuntimeException("Only one Looper may be created per thread");
    }
    sThreadLocal.set(new Looper(quitAllowed));
}

// Looper 构造函数，新建消息队列
private Looper(boolean quitAllowed) {
    mQueue = new MessageQueue(quitAllowed);
    mThread = Thread.currentThread();
}
```

#### MessageQueue.java

```java
public final class MessageQueue {
  
  MessageQueue(boolean quitAllowed) {
    mQuitAllowed = quitAllowed;
    mPtr = nativeInit();
  }
  
}
```

#### android_os_MessageQueue.cpp

```c++
static jlong android_os_MessageQueue_nativeInit(JNIEnv* env, jclass clazz) {
    NativeMessageQueue* nativeMessageQueue = new NativeMessageQueue();
    if (!nativeMessageQueue) {
        jniThrowRuntimeException(env, "Unable to allocate native queue");
        return 0;
    }
    // 引用计数
    nativeMessageQueue->incStrong(env);
    // 返回内存地址
    return reinterpret_cast<jlong>(nativeMessageQueue);
}

// 构造 Native 层的消息队列
NativeMessageQueue::NativeMessageQueue() :
        mPollEnv(NULL), mPollObj(NULL), mExceptionObj(NULL) {
    mLooper = Looper::getForThread();
    if (mLooper == NULL) {
      	// 构造 native 层的 Looper
        mLooper = new Looper(false);
        Looper::setForThread(mLooper);
    }
}
```

#### Looper.cpp

```c++
Looper::Looper(bool allowNonCallbacks)
    : mAllowNonCallbacks(allowNonCallbacks),
      mSendingMessage(false),
      mPolling(false),
      mEpollRebuildRequired(false),
      mNextRequestSeq(0),
      mResponseIndex(0),
      mNextMessageUptime(LLONG_MAX) {
    // 6.0 以前是使用的匿名管道，6.0 开始使用 eventfd
    // eventfd 只需要创建一个虚拟文件，pipe 需要两个（一个用来读一个用来写）
    mWakeEventFd.reset(eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC));
    LOG_ALWAYS_FATAL_IF(mWakeEventFd.get() < 0, "Could not make wake event fd: %s", strerror(errno));

    AutoMutex _l(mLock);
    // 创建 epoll
    rebuildEpollLocked();
}

void Looper::rebuildEpollLocked() {
		...
    // epoll_create1: 创建 epoll 实例
    mEpollFd.reset(epoll_create1(EPOLL_CLOEXEC));
    struct epoll_event eventItem;
    memset(& eventItem, 0, sizeof(epoll_event));
    // EPOLLIN： 读事件
    eventItem.events = EPOLLIN;
    eventItem.data.fd = mWakeEventFd.get();
    // epoll_ctl: 对 EventFd 添加监听
    int result = epoll_ctl(mEpollFd.get(), EPOLL_CTL_ADD, mWakeEventFd.get(), &eventItem);
    ...
}
```

### Handler 初始化

Handler 初始化时，会保存当前线程的 Looper 或传入的 Looper，同时保存 Looper 内的 MessageQueue

#### Handler.java

```java
public Handler(Callback callback, boolean async) {
    ...
    mLooper = Looper.myLooper();
    if (mLooper == null) {
        throw new RuntimeException(
            "Can't create handler inside thread " + Thread.currentThread()
                   + " that has not called Looper.prepare()");
    }
    mQueue = mLooper.mQueue;
    mCallback = callback;
    mAsynchronous = async;
}
```

## 监听消息

1. 调用 Looper.loop 方法，会调用 MessageQueue::next() 方法获得下一个消息
2. MessageQueue::next() 又会调用 nativePollOnce 方法，第一次传 0，不阻塞，然后取消息，没有消息的话，传 -1，一直阻塞：
   1. 如果有同步屏障，取第一个异步消息
   2. 否则，如果有 到时间了 的消息，取第一个消息
   3. 否则，计算要阻塞多久，下次循环传入 nativePollOne 方法内
   4. 如果有 IdleHandler，执行，并将阻塞时间改为 0，因为可能执行 IdleHandler 的时候有消息插入了
3. nativePollOne 会调用对应的 NativeMessageQueue 的 pollOnce 方法
4. NativeMessageQueue::pollOnce 又会调用 native 层的 Looper::pollOnce 方法
5. native 的 Looper::pollOnce 最后会调用到 Looper::pollInner 方法
6. 在 Looper::pollInner 方法内部：
   1. 首先会计算阻塞时间，由 java 层传入的时间 和 native 层下个消息的阻塞时间 的最小值决定
   2. 会调用 epoll_wait 监听所有事件
   3. 如果是被 EPOLLIN 事件唤醒的，去读取写入 eventfd 的数据
   4. 如果是被其他事件唤醒的，就尝试用 fd 拿 Request，拿到的话加到 mResponses 中
   5. 处理 native 层的 Message，跟 java 层的逻辑差不多；到时间的消息就分发；没到就直接获取队列第一个，保存需要执行的时间点，然后退出队列循环；因为队列本身就是按执行时间排序的
   6. 最后执行第 4 步的 mResponses 内的 LooperCallback，比如触摸事件
7. 回到 java 层，这时候 nativePollOnce  方法的阻塞已经结束了，便可以继续本次循环获得消息
8. 获得消息后，会调用 Message.target 也就是对应的 handler 的 dispatchMessage 方法分发消息
9. Handler::dispatchMessage 方法会先按顺序分发消息
   1. 优先执行 Message.callback
   2. 没有的话，执行 Handler.mCallback
   3. 也没有的话，执行 Handler.handleMessgae
10. 消息分发结束后，会调用 Message::recycleUnchecked() 方法，如果消息池没满，则将该消息加入到消息池中以便复用，这里指的消息池其实就是一个链表

#### Looper.java

```java
public static void loop() {
  final Looper me = myLooper(); // 获得当前线程的 looper
  ...
  final MessageQueue = me.mQueue; // 获得消息队列
  ...
  for(;;) {
    Message msg = queue.next(); // 当前没有消息时，该方法会阻塞
    if(msg == null) {
      return; // 返回 null 说明消息队列正在退出
    }
    // 日志
    final Printer logging = me.mLogging;
    if (logging != null) {
        logging.println(">>>>> Dispatching to " + msg.target + " " +
                msg.callback + ": " + msg.what);
    }
    ...
    try{
      msg.target.dispatchMessage(msg); // 分发消息
    } finally {
      ...
    }
    ...
    // 日志
    if (logging != null) {
        logging.println("<<<<< Finished to " + msg.target + " " + msg.callback);
    }
    ...
    // 回收消息到消息池以便复用，调用 `Message.obtain()` 会优先从消息池中取对象
    msg.recycleUnchecked(); 
  }
}
```

#### Handler.java

```java
public void dispatchMessage(@NonNull Message msg) {
    if (msg.callback != null) {
        // 优先执行 msg.callback
        handleCallback(msg);
    } else {
        // 优先执行 Handler 的全局 callback
        if (mCallback != null) {
            // 返回 true 的话，不再继续分发到 handleMessage
            if (mCallback.handleMessage(msg)) {
                return;
            }
        }
        // 最后才执行 Handler 本身的 handleMessage
        handleMessage(msg);
    }
}
```

#### MessageQueue.java

```java
Message next() {
  ...
  // poll 的时候超时时间，0就是不阻塞，-1 就是无限期阻塞，其他就是超时时间
  int nextPollTimeoutMillis = 0;
  for(;;) {
    // 阻塞，到时间或者队列被唤醒，都会返回
    nativePollOnce(ptr, nextPollTimeoutMillis);
    synchronized (this) {
      Message prevMsg = null;
      Message msg = mMessages;
      // 如果调用过 postSyncBarrier 方法，设置了同步屏障，那么就直接取异步消息
      if(msg != null && msg.target == null) {
        // 取第一个异步消息
        do {
            prevMsg = msg;
            msg = msg.next;
        } while (msg != null && !msg.isAsynchronous());
      }
      // 假如取到了消息
      if(msg != null) {
        // 还没到时间，需要延时，计算要延时多久
        if(now < msg.when) {
          nextPollTimeoutMillis = (int) Math.min(msg.when - now, Integer.MAX_VALUE);
        }
        // 到时间了，直接取出 msg 返回就行
        else {
          if (prevMsg != null) {
              prevMsg.next = msg.next;
          } else {
              mMessages = msg.next;
          }
          msg.next = null;
          msg.markInUse();
          return msg;
        }
      } 
      // 没有消息，下次就开始无限期阻塞
      else {
        nextPollTimeoutMillis = -1;
      }
      // 正在退出，返回 null
      if(mQuitting) {
        dispose();
        return null;
      }
      // 之后还会执行 idleHandler
      ...
    }
  }
}
```

#### android_os_MessageQueue.cpp

```c++
static void android_os_MessageQueue_nativePollOnce(JNIEnv* env, jobject obj,
        jlong ptr, jint timeoutMillis) {
    NativeMessageQueue* nativeMessageQueue = reinterpret_cast<NativeMessageQueue*>(ptr);
    nativeMessageQueue->pollOnce(env, obj, timeoutMillis);
}

void NativeMessageQueue::pollOnce(JNIEnv* env, jobject pollObj, int timeoutMillis) {
    ...
    // 调用到 Looper
    mLooper->pollOnce(timeoutMillis);
    ...
}
```

#### Looper.cpp

```c++
int Looper::pollOnce(int timeoutMillis, int* outFd, int* outEvents, void** outData) {
  	...
    for(;;) {
        ...
        result = pollInner(timeoutMillis);
    }
}

int Looper::pollInner(int timeoutMillis) {
  	// 计算要阻塞多久，以 java 层传入的 timeout 和 native 层下个消息的延时的最小值决定
    // 这里如果是 native 层的消息延时，执行完成后又会回到 java，然后重新算出 timeout 传入
    if (timeoutMillis != 0 && mNextMessageUptime != LLONG_MAX) {
        nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
        int messageTimeoutMillis = toMillisecondTimeoutDelay(now, mNextMessageUptime);
        if (messageTimeoutMillis >= 0
                && (timeoutMillis < 0 || messageTimeoutMillis < timeoutMillis)) {
            timeoutMillis = messageTimeoutMillis;
        }
    }
    ...
    // 等待 epoll 事件，如果没有将阻塞
    int eventCount = epoll_wait(mEpollFd.get(), eventItems, EPOLL_MAX_EVENTS, timeoutMillis);
  	...
    mLock.lock();
    ...
    for(int i = 0; i < eventCount; i++) {
        int fd = eventItems[i].data.fd;
        uint32_t epollEvents = eventItems[i].events;
        if(fd == mWakeEventFd.get()) {
            if (epollEvents & EPOLLIN) {
                // 是被写事件唤醒的，读取内容
                awoken();
            }
            ...
        } else {
            // 将通过 addFd 方法加入进来的 LooperCallback 加入 vector 中，比如触摸事件
            ssize_t requestIndex = mRequests.indexOfKey(fd);
            if (requestIndex >= 0) {
                int events = 0;
                if (epollEvents & EPOLLIN) events |= EVENT_INPUT;
                if (epollEvents & EPOLLOUT) events |= EVENT_OUTPUT;
                if (epollEvents & EPOLLERR) events |= EVENT_ERROR;
                if (epollEvents & EPOLLHUP) events |= EVENT_HANGUP;
                pushResponse(events, mRequests.valueAt(requestIndex));
            }
            ...
        }
        ...
    }
    ...
    // 处理 native 层的消息，这部分逻辑跟 java 层其实差不多
    mNextMessageUptime = LLONG_MAX;
    while (mMessageEnvelopes.size() != 0) {
        nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
        const MessageEnvelope& messageEnvelope = mMessageEnvelopes.itemAt(0);
        if (messageEnvelope.uptime <= now) {
            { // obtain handler
                sp<MessageHandler> handler = messageEnvelope.handler;
                Message message = messageEnvelope.message;
                mMessageEnvelopes.removeAt(0);
                mSendingMessage = true;
                mLock.unlock();
                // 分发消息
                handler->handleMessage(message);
            } // release handler
            mLock.lock();
            mSendingMessage = false;
            result = POLL_CALLBACK;
        } else {
            // 下一个消息执行的事件点，消息队列是按时间顺序排列的
            // 所以一碰到需要阻塞的消息，就可以直接赋值并退出循环了
            mNextMessageUptime = messageEnvelope.uptime;
            break;
        }
    }
    mLock.unlock();
    // 处理通过 addFd 传入的 LooperCallback，比如触摸事件
    for (size_t i = 0; i < mResponses.size(); i++) {
        Response& response = mResponses.editItemAt(i);
        if (response.request.ident == POLL_CALLBACK) {
            int fd = response.request.fd;
            int events = response.events;
            void* data = response.request.data;
            // 执行 LooperCallback
            int callbackResult = response.request.callback->handleEvent(fd, events, data);
            if (callbackResult == 0) {
                removeFd(fd, response.request.seq);
            }
            response.request.callback.clear();
            result = POLL_CALLBACK;
        }
    }
    return result;
}

void Looper::awoken() {
    uint64_t counter;
  	// 读数据
    TEMP_FAILURE_RETRY(read(mWakeEventFd.get(), &counter, sizeof(uint64_t)));
}
```

## 发送消息

1. 通过 Message.obtain 构造 Message，会优先从缓冲池里取
2. 调用 Handler::sendMessage 方法，经过类内部的几次方法调用，最后会调用到 MessageQueue 的 enqueueMessage 方法，这个 MessageQueue 就是 Handler 初始化时获得的
3. Message::enqueueMessage 方法会按时间顺序将消息插入到链表中，然后根据需要调用 nativeWake 唤醒 Looper 对应的线程
4. Message::nativeWake 会调用 native 层的 NativeMessageQueue 的 wake 方法
5. NativeMessageQueue::wake 会调用 native 的 Looper::wake 方法
6. Looper::wake 会往 eventfd 内写入数据（整数 1），从而唤醒等待中的 epoll

#### Message.java

```java
public static Message obtain() {
    synchronized (sPoolSync) {
      	// 如果消息池内有对象，那么复用
        if (sPool != null) {
            Message m = sPool;
            sPool = m.next;
            m.next = null;
            m.flags = 0;
            sPoolSize--;
            return m;
        }
    }
    return new Message();
}
```

#### Handler.java

```java
public final boolean sendMessage(@NonNull Message msg) {
    return sendMessageDelayed(msg, 0);
}

public final boolean sendMessageDelayed(@NonNull Message msg, long delayMillis) {
    if (delayMillis < 0) {
       delayMillis = 0;
    }
    return sendMessageAtTime(msg, SystemClock.uptimeMillis() + delayMillis);
}

public boolean sendMessageAtTime(@NonNull Message msg, long uptimeMillis) {
    MessageQueue queue = mQueue;
    ...
    return enqueueMessage(queue, msg, uptimeMillis);
}

// 注意这里的时间，只有通过 sendMessageAtFrontOfQueue 方法传入的才会是 0
private boolean enqueueMessage(@NonNull MessageQueue queue, @NonNull Message msg,
            long uptimeMillis) {
    msg.target = this;
    msg.workSourceUid = ThreadLocalWorkSource.getUid();
		// 异步消息，final变量，构造的时候就要传入
    if (mAsynchronous) {
        msg.setAsynchronous(true);
    }
    return queue.enqueueMessage(msg, uptimeMillis);
}
```

#### MessageQueue.java

```java
boolean enqueueMessage(Message msg, long when) {
  // 同步屏障消息不是这个方法
  if (msg.target == null) {
      throw new IllegalArgumentException("Message must have a target.");
  }
  ...
  synchronized (this) {
    // 退出了，直接回收消息
    if(mQuitting) {
      msg.recycle();
      return false;
    }
    ...  
    Message p = mMessages;
    boolean needWake;
    // 如果队列为空、消息时间为 0、或者比队列头的时间还早，直接插入到队列头
    // 注意这里消息时间为 0，只有调用 `sendMessageAtFrontOfQueue` 方法才会是 0
    if (p == null || when == 0 || when < p.when) {  
        msg.next = p;
        mMessages = msg;
      	// 是否需要唤醒取决于当前是不是被 block 了
        needWake = mBlocked;
    }
    else {
      needWake = mBlocked && p.target == null && msg.isAsynchronous();
      Message prev;
      for (;;) {
          prev = p;
          p = p.next;
          // 插入到最后一个，或者按时间插入
          if (p == null || when < p.when) {
              break;
          }
          if (needWake && p.isAsynchronous()) {
              needWake = false;
          }
      }
      msg.next = p;
      prev.next = msg;
    }
    if (needWake) {
      	// 唤醒 looper 对应的线程
        nativeWake(mPtr);
    }
  }
}
```

#### android_os_MessageQueue.cpp

```c++
static void android_os_MessageQueue_nativeWake(JNIEnv* env, jclass clazz, jlong ptr) {
    NativeMessageQueue* nativeMessageQueue = reinterpret_cast<NativeMessageQueue*>(ptr);
    nativeMessageQueue->wake();
}

void NativeMessageQueue::wake() {
    mLooper->wake();
}
```

#### Looper.cpp

```c++
void Looper::wake() {
    uint64_t inc = 1;
    // 写入一个 1 到 eventfd, 然后 Looper.loop 那边的 epoll 就会收到消息，从而退出阻塞唤醒线程
    ssize_t nWrite = TEMP_FAILURE_RETRY(write(mWakeEventFd.get(), &inc, sizeof(uint64_t)));
    ...
}
```

### native 层的消息

native 层唤醒 epoll 有两个方法，一个是通过 `addFd` 方法，一个是通过 `sendMessage` 系列方法来唤醒；

#### Looper.cpp ( addFd )

```c++
int Looper::addFd(int fd, int ident, int events, Looper_callbackFunc callback, void* data) {
    return addFd(fd, ident, events, callback ? new SimpleLooperCallback(callback) : nullptr, data);
}

int Looper::addFd(int fd, int ident, int events, const sp<LooperCallback>& callback, void* data) {
    ...
    if (!callback.get()) {
        // 不允许设置空的 LooperCallback
        if (! mAllowNonCallbacks) {
            ALOGE("Invalid attempt to set NULL callback but not allowed for this looper.");
            return -1;
        }
        if (ident < 0) {
            ALOGE("Invalid attempt to set NULL callback with ident < 0.");
            return -1;
        }
    } else {
        ident = POLL_CALLBACK;
    }

    { // acquire lock
        AutoMutex _l(mLock);
        ...
        // 看当前表中有没有该 fd 对应的 Request
        ssize_t requestIndex = mRequests.indexOfKey(fd); 
        if (requestIndex < 0) {
            // 没有的话，直接发送 EPOLL_CTL_ADD 唤醒对应线程
            int epollResult = epoll_ctl(mEpollFd.get(), EPOLL_CTL_ADD, fd, &eventItem);
            if (epollResult < 0) {
                ALOGE("Error adding epoll events for fd %d: %s", fd, strerror(errno));
                return -1;
            }
            // 先唤醒再加入表中，因为这里用了 mLock，所以不用担心错误遍历时机
            mRequests.add(fd, request);
        } else {
            // 如果已经有了，发送 EPOLL_CTL_MOD 事件
            int epollResult = epoll_ctl(mEpollFd.get(), EPOLL_CTL_MOD, fd, &eventItem);
            if (epollResult < 0) {
                if (errno == ENOENT) {
                    // 如果 fd 已经被移除了，就发送 EPOLL_CTL_ADD 事件
                    epollResult = epoll_ctl(mEpollFd.get(), EPOLL_CTL_ADD, fd, &eventItem);
                    if (epollResult < 0) {
                        ALOGE("Error modifying or adding epoll events for fd %d: %s",
                                fd, strerror(errno));
                        return -1;
                    }
                    scheduleEpollRebuildLocked();
                } else {
                    ALOGE("Error modifying epoll events for fd %d: %s", fd, strerror(errno));
                    return -1;
                }
            }
            // 替换表内的 Request
            mRequests.replaceValueAt(requestIndex, request);
        }
    } // release lock
    return 1;
}

```

`addFd` 就是通过 `EPOLL_CTL_ADD` 或者 `EPOLL_CTL_MOD` 来唤醒线程，跟正常调用 `wake` 方法写入唤醒的 `EPOLLIN` 事件是不同的。

#### Looper.cpp ( sendMessage )

```c++
void Looper::sendMessage(const sp<MessageHandler>& handler, const Message& message) {
    nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
    sendMessageAtTime(now, handler, message);
}

void Looper::sendMessageDelayed(nsecs_t uptimeDelay, const sp<MessageHandler>& handler,
        const Message& message) {
    nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
    sendMessageAtTime(now + uptimeDelay, handler, message);
}

void Looper::sendMessageAtTime(nsecs_t uptime, const sp<MessageHandler>& handler,
        const Message& message) {
    ...
    size_t i = 0;
    { // acquire lock
        AutoMutex _l(mLock);
        // 按时间顺序，找到要插入的位置并插入
        size_t messageCount = mMessageEnvelopes.size();
        while (i < messageCount && uptime >= mMessageEnvelopes.itemAt(i).uptime) {
            i += 1;
        }
        MessageEnvelope messageEnvelope(uptime, handler, message);
        mMessageEnvelopes.insertAt(messageEnvelope, i, 1);
      
        // 如果当前正在分发消息，就不调用 wake 方法，因为在遍历消息的时候会遍历到这个消息，也是通过 mLock 来控制并发的
        if (mSendingMessage) {
            return;
        }
    } // release lock
    // 如果 i 等于 0，说明插入到队列头了，那就要唤醒了，否则不需要唤醒
    if (i == 0) {
        wake();
    }
}
```

## IdleHandler

### 添加

#### MessageQueue.java

```java
public void addIdleHandler(@NonNull IdleHandler handler) {
    if (handler == null) {
        throw new NullPointerException("Can't add a null IdleHandler");
    }
    synchronized (this) {
        mIdleHandlers.add(handler);
    }
}
```

### 移除

移除有两个方式：

- 直接调用 MessageQueue::removeIdleHandler
- 在 IdleHandler::queueIdle 方法中返回 false，这个返回值是 isKeep 的意思

#### MessageQueue.java

```java
public void removeIdleHandler(@NonNull IdleHandler handler) {
    synchronized (this) {
        mIdleHandlers.remove(handler);
    }
}
```

### 调用

#### MessageQueue.java

```java
Message next() {
  ...
  int pendingIdleHandlerCount = -1;
  for(;;) {
    synchronized(this) {
      // 如果这里没有取到想要的 Message
      ...
      // 如果是第一次进入循环，且没有消息 或者 第一个消息都还没到执行的时间 
      // 也就是说，假如当前有同步屏障消息，是不会调用 IdleHandler 的  
      if (pendingIdleHandlerCount < 0
              && (mMessages == null || now < mMessages.when)) {
          pendingIdleHandlerCount = mIdleHandlers.size();
      }
      // 不执行，那就阻塞
      if (pendingIdleHandlerCount <= 0) {
          mBlocked = true;
          continue;
      }
      if (mPendingIdleHandlers == null) {
          mPendingIdleHandlers = new IdleHandler[Math.max(pendingIdleHandlerCount, 4)];
      }
      mPendingIdleHandlers = mIdleHandlers.toArray(mPendingIdleHandlers);
    }
    for (int i = 0; i < pendingIdleHandlerCount; i++) {
      final IdleHandler idler = mPendingIdleHandlers[i];
      mPendingIdleHandlers[i] = null;

      boolean keep = false;
      try {
          keep = idler.queueIdle();
      } catch (Throwable t) {
          Log.wtf(TAG, "IdleHandler threw exception", t);
      }

      // 如果返回的是 false，那么删除
      if (!keep) {
          synchronized (this) {
              mIdleHandlers.remove(idler);
          }
      }
    }
    
    // 把 count 设置为 0，这样进入下次循环的时候，就不会再次执行 IdleHandler
    // 每调用一次 next 方法最多只会执行一次
    pendingIdleHandlerCount = 0;
    // 为了防止执行 IdleHandler 过程中有消息来，所以这次 poll 不阻塞
    nextPollTimeoutMillis = 0;
  }
}
```

## 同步屏障 SyncBarrier

同步屏障就是 target，也就是对应的 handler 为空的消息，在 MessageQueue::next 方法中，一旦发现第一个消息是屏障消息，就只会找异步消息，一般用来处理一些比较优先的任务，比如在 ViewRootImpl::scheduleTraversals 方法中用来绘制界面；

### 添加

#### MessageQueue.java

```java
// 这个就是屏障消息的 token
private int mNextBarrierToken;

public int postSyncBarrier() {
    return postSyncBarrier(SystemClock.uptimeMillis());
}

private int postSyncBarrier(long when) {
    synchronized (this) {
        final int token = mNextBarrierToken++;
        final Message msg = Message.obtain();
        msg.markInUse();
        msg.when = when;
        msg.arg1 = token;
        
        // 可以看到，屏障消息的插入，也是需要查找的
        // 比如当前队列有通过 Handler::sendMessageAtFrontOfQueue 方法插入的消息，也就是 when = 0 的消息
        // 那屏障消息就得在这个消息后面
        Message prev = null;
        Message p = mMessages;
        if (when != 0) {
            while (p != null && p.when <= when) {
                prev = p;
                p = p.next;
            }
        }
        if (prev != null) {
            msg.next = p;
            prev.next = msg;
        } else {
            msg.next = p;
            mMessages = msg;
        }
        return token;
    }
}
```

### 移除

#### MessageQueue.java

```java
public void removeSyncBarrier(int token) {
    synchronized (this) {
        Message prev = null;
        Message p = mMessages;
        // 找到消息
        while (p != null && (p.target != null || p.arg1 != token)) {
            prev = p;
            p = p.next;
        }
        if (p == null) {
            throw new IllegalStateException("The specified message queue synchronization "
                    + " barrier token has not been posted or has already been removed.");
        }
        final boolean needWake;
        // 如果当前消息不是链表头，那就不需要唤醒
        if (prev != null) {
            prev.next = p.next;
            needWake = false;
        } else {
            mMessages = p.next;
            needWake = mMessages == null || mMessages.target != null;
        }
        // 回收消息
        p.recycleUnchecked();

        if (needWake && !mQuitting) {
            nativeWake(mPtr);
        }
    }
}
```

### 调用

#### MessageQueue.java

```java
Message next() {
  ...
  for(;;) {
    ...
    synchronized (this) {
      Message prevMsg = null;
      Message msg = mMessages;
      // 如果队列头是同步屏障消息，那么就直接取异步消息
      if(msg != null && msg.target == null) {
        // 取第一个异步消息
        do {
            prevMsg = msg;
            msg = msg.next;
        } while (msg != null && !msg.isAsynchronous());
      }
      // 处理消息
      ...
    }
  }
}
```



