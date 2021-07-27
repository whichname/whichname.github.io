---
title: Service 启动流程
tags: ["android-source"]
key: startService
---

<!--more-->

在此记录一下 Service 启动的调用链，本次分析基于 Android Api 28.

## `Service::onCreate()`

### 客户端进程

调用 `Activity::startService()` 或者 `Service::startService()` 其实都是调用了父类的方法 `ContextWrapper::startService()` 

#### ContextWrapper.java

```java
    public ComponentName startService(Intent service) {
        // mBase 是通过 ContextWrapper::attachBaseContext() 方法传入的
        return mBase.startService(service);
    }

    Context mBase;
    // 这个方法会在 ActivityThread::performLaunchActivity() 被调用，传入的是 ContextImpl 对象
    protected void attachBaseContext(Context base) {
        if (mBase != null) {
            throw new IllegalStateException("Base context already set");
        }
        mBase = base;
    }
```

#### ContextImpl.java

```java
    public ComponentName startService(Intent service) {
        warnIfCallingFromSystemProcess();
        return startServiceCommon(service, false, mUser);
    }

    private ComponentName startServiceCommon(Intent service, boolean requireForeground,
            UserHandle user) {
        ...
        ComponentName cn = ActivityManager.getService().startService(
            mMainThread.getApplicationThread(), service, service.resolveTypeIfNeeded(
                        getContentResolver()), requireForeground,
                        getOpPackageName(), user.getIdentifier());
        ...
    }
```

#### ActivityManager.java

```java
    public static IActivityManager getService() {
        return IActivityManagerSingleton.get();
    }

    private static final Singleton<IActivityManager> IActivityManagerSingleton =
            new Singleton<IActivityManager>() {
                @Override
                protected IActivityManager create() {
                    final IBinder b = ServiceManager.getService(Context.ACTIVITY_SERVICE);
                    final IActivityManager am = IActivityManager.Stub.asInterface(b);
                    return am;
                }
            };
```

### system_server 进程

#### ActivityManagerService.java

```java
    public ComponentName startService(IApplicationThread caller, Intent service,
            String resolvedType, boolean requireForeground, String callingPackage, int userId)
            throws TransactionTooLargeException {
        ...
        ComponentName res;
        res = mServices.startServiceLocked(caller, service,
                  resolvedType, callingPid, callingUid,
                  requireForeground, callingPackage, userId);
        return res;
    }

    final ActiveServices mServices;
```

#### ActiveServices.java

```java
    ComponentName startServiceLocked(IApplicationThread caller, Intent service, String resolvedType,
            int callingPid, int callingUid, boolean fgRequired, String callingPackage, final int userId)
            throws TransactionTooLargeException {
        ...
        // 添加 pendingStarts, 用来执行 onStartCommand()
        r.pendingStarts.add(new ServiceRecord.StartItem(r, false, r.makeNextStartId(),
                service, neededGrants, callingUid));
        ...
        ComponentName cmp = startServiceInnerLocked(smap, service, r, callerFg, addToStarting);
        return cmp;
    }

    ComponentName startServiceInnerLocked(ServiceMap smap, Intent service, ServiceRecord r,
            boolean callerFg, boolean addToStarting) throws TransactionTooLargeException {
        ...
        String error = bringUpServiceLocked(r, service.getFlags(), callerFg, false, false);
        if (error != null) {
            return new ComponentName("!!", error);
        }
        ...
        return r.name;
    }

    private String bringUpServiceLocked(ServiceRecord r, int intentFlags, boolean execInFg,
            boolean whileRestarting, boolean permissionsReviewRequired)
            throws TransactionTooLargeException {
        ...
        realStartServiceLocked(r, app, execInFg);
        ...
    }

    private final void realStartServiceLocked(ServiceRecord r,
            ProcessRecord app, boolean execInFg) throws RemoteException {
        ...
        // 给 ServiceRecord::app 赋值
        r.app = app;
        ...
        // 这个方法进入就是埋 ANR 炸弹的地方
        bumpServiceExecutingLocked(r, execInFg, "create");
        ...
        boolean created = false;
        try {
            ...
            // 启动 Service
            app.thread.scheduleCreateService(r, r.serviceInfo,
                    mAm.compatibilityInfoForPackageLocked(r.serviceInfo.applicationInfo),
                    app.repProcState);
            ...
            created = true;
        } catch (DeadObjectException e) {
            ...
        } finally {
            // 启动失败了，created 还是 false
            if (!created) {
                ...
                // 拆掉之前埋的 ANR 的炸弹
                serviceDoneExecutingLocked(r, inDestroying, inDestroying);
                ...
            }
        }
        ...
        // 这里最后就会调用到 Service::onStartCommand() 方法
        sendServiceArgsLocked(r, execInFg, true);
        ...
    }
```

### 客户端进程

#### ActivityThread.java

```java
public final class ActivityThread extends ClientTransactionHandler {

    private class ApplicationThread extends IApplicationThread.Stub {
      
        public final void scheduleCreateService(IBinder token,
                ServiceInfo info, CompatibilityInfo compatInfo, int processState) {
            updateProcessState(processState, false);
            CreateServiceData s = new CreateServiceData();
            s.token = token;
            s.info = info;
            s.compatInfo = compatInfo;
            // 发送消息到 H
            sendMessage(H.CREATE_SERVICE, s);
        }
      
    }
  
    class H extends Handler {

        public void handleMessage(Message msg) {
                ...
                case CREATE_SERVICE:
                    handleCreateService((CreateServiceData)msg.obj);
                    break;
                ...
        }
      
    }
  
    private void handleCreateService(CreateServiceData data) {
        ...
        Service service = null;
        // 创建 Service 实例
        java.lang.ClassLoader cl = packageInfo.getClassLoader();
        service = packageInfo.getAppFactory()
                .instantiateService(cl, data.info.name, data.intent);
        // 创建 ContextImpl 实例
        ContextImpl context = ContextImpl.createAppContext(this, packageInfo);
        context.setOuterContext(service);
        ...
        // 调用 Service::attach()
        service.attach(context, this, data.info.name, data.token, app,
                ActivityManager.getService());
        // 调用 Service::onCreate()
        service.onCreate();
        mServices.put(data.token, service);
        // 调用 AMS::serviceDoneExecuting() 通知 AMS 执行完毕
        ActivityManager.getService().serviceDoneExecuting(
                data.token, SERVICE_DONE_EXECUTING_ANON, 0, 0);
        ...
    }
  
}
```

自此，`Service::onCreate()` 执行完毕，接下来还会继续调用到 AMS 拆掉之前埋的 ANR 炸弹，这部分后面再看，先看 `Service::onStartCommand()`.

## `Service::onStartCommand()`

### system_server 进程

接着上面 [`ActiveServices::realStartServiceLocked()`](#activeservicesjava) 方法，启动完 `Service` 后会调用 `ActiveServices::sendServiceArgsLocked()` 方法：

#### ActiveServices.java

```java
    private final void sendServiceArgsLocked(ServiceRecord r, boolean execInFg,
            boolean oomAdjusted) throws TransactionTooLargeException {
        ...
        ArrayList<ServiceStartArgs> args = new ArrayList<>();
        while (r.pendingStarts.size() > 0) {
            ServiceRecord.StartItem si = r.pendingStarts.remove(0);
            ...
            // 埋 ANR 的炸弹
            bumpServiceExecutingLocked(r, execInFg, "start");
            ...
            args.add(new ServiceStartArgs(si.taskRemoved, si.id, flags, si.intent));
        }

        Exception caughtException = null;
        try {
            // 调用到 Service::onStartCommand()
            r.app.thread.scheduleServiceArgs(r, slice);
        } catch (TransactionTooLargeException e) {
            caughtException = e;
        } catch (RemoteException e) {
            caughtException = e;
        } catch (Exception e) {
            caughtException = e;
        }

        if (caughtException != null) {
            // 调用失败，取消炸弹
            for (int i = 0; i < args.size(); i++) {
                serviceDoneExecutingLocked(r, inDestroying, inDestroying);
            }
            ...
        }
    }
```

### 客户端进程

#### ActivityThread.java

```java
public final class ActivityThread extends ClientTransactionHandler {

    private class ApplicationThread extends IApplicationThread.Stub {
      
        public final void scheduleServiceArgs(IBinder token, ParceledListSlice args) {
            List<ServiceStartArgs> list = args.getList();

            for (int i = 0; i < list.size(); i++) {
                ServiceStartArgs ssa = list.get(i);
                ServiceArgsData s = new ServiceArgsData();
                s.token = token;
                s.taskRemoved = ssa.taskRemoved;
                s.startId = ssa.startId;
                s.flags = ssa.flags;
                s.args = ssa.args;
                sendMessage(H.SERVICE_ARGS, s);
            }
        }
      
    }
  
    class H extends Handler {

        public void handleMessage(Message msg) {
                ...
                case SERVICE_ARGS:
                    handleServiceArgs((ServiceArgsData)msg.obj);
                    break;
                ...
        }
      
    }
  
    private void handleServiceArgs(ServiceArgsData data) {
        Service s = mServices.get(data.token);
        if (s != null) {
                ...
                int res;
                if (!data.taskRemoved) {
                    // 调用 Service::onStartCommand()
                    res = s.onStartCommand(data.args, data.flags, data.startId);
                } else {
                    s.onTaskRemoved(data.args);
                    res = Service.START_TASK_REMOVED_COMPLETE;
                }
                ...
                // 通知 AMS 执行完毕
                ActivityManager.getService().serviceDoneExecuting(
                        data.token, SERVICE_DONE_EXECUTING_START, data.startId, res);
                ...
        }
    }
  
}
```

以上是第一次调用 `startService()` 的情况，之后调用就不会再走 `Service::onCreate()` 了。

在 [`ActiveServices::realStartServiceLocked()`](#activeservicesjava) 中可以看到，会调用 `r.app = app` 赋值，那么第二次调用 `startService()` 时，一样会走到 `ActiveService::bringUpServiceLocked()` :

### system_server 进程

#### ActiveServices.java

```java
    private String bringUpServiceLocked(ServiceRecord r, int intentFlags, boolean execInFg,
            boolean whileRestarting, boolean permissionsReviewRequired)
            throws TransactionTooLargeException {
        // 第二次来的时候，r.app 已经不是 null 了，所以直接调用到 sendServiceArgsLocked() 方法
        // 之后就跟上面一样了
        if (r.app != null && r.app.thread != null) {
            sendServiceArgsLocked(r, execInFg, false);
            return null;
        }
        ...
        realStartServiceLocked(r, app, execInFg);
        ...
    }
```

## `Service::onBind()`

### 客户端进程

#### ContextWrapper.java

```java
    public boolean bindService(Intent service, ServiceConnection conn,
            int flags) {
        // 上面说过了，mBase 就是 ContextImpl 对象
        return mBase.bindService(service, conn, flags);
    }
```

#### ContextImpl.java

```java
    public boolean bindService(Intent service, ServiceConnection conn,
            int flags) {
        return bindServiceCommon(service, conn, flags, mMainThread.getHandler(), getUser());
    }

    private boolean bindServiceCommon(Intent service, ServiceConnection conn, int flags, Handler
            handler, UserHandle user) {
        // 这里创建 IServiceConnection，具体后面分析
        IServiceConnection sd;
        sd = mPackageInfo.getServiceDispatcher(conn, getOuterContext(), handler, flags);
        ...
        // 调用到 AMS
        int res = ActivityManager.getService().bindService(
            mMainThread.getApplicationThread(), getActivityToken(), service,
            service.resolveTypeIfNeeded(getContentResolver()),
            sd, flags, getOpPackageName(), user.getIdentifier());
        ...
    }
```

### system_server 进程

#### ActivityManagerService.java

```java
    public int bindService(IApplicationThread caller, IBinder token, Intent service,
            String resolvedType, IServiceConnection connection, int flags, String callingPackage,
            int userId) throws TransactionTooLargeException {
        ...
            return mServices.bindServiceLocked(caller, token, service,
                    resolvedType, connection, flags, callingPackage, userId);
    }
```

#### ActiveServices.java

```java
    int bindServiceLocked(IApplicationThread caller, IBinder token, Intent service,
            String resolvedType, final IServiceConnection connection, int flags,
            String callingPackage, final int userId) throws TransactionTooLargeException {
        ...
        ServiceLookupResult res =
            retrieveServiceLocked(service, resolvedType, callingPackage, Binder.getCallingPid(),
                    Binder.getCallingUid(), userId, true, callerFg, isBindExternal, allowInstant);
        ...
        ServiceRecord s = res.record;
        ...
        AppBindRecord b = s.retrieveAppBindingLocked(service, callerApp);
        // 创建 ConnectionRecord 并添加到 ServiceRecord 的 connections 中
        // connections 是一个 ArrayMap<IBinder, ArrayList<ConnectionRecord>> 对象
        ConnectionRecord c = new ConnectionRecord(b, activity,
                connection, flags, clientLabel, clientIntent);
        IBinder binder = connection.asBinder();
        ArrayList<ConnectionRecord> clist = s.connections.get(binder);
        if (clist == null) {
            clist = new ArrayList<ConnectionRecord>();
            s.connections.put(binder, clist);
        }
        clist.add(c);
        ...
        if ((flags&Context.BIND_AUTO_CREATE) != 0) {
            s.lastActivity = SystemClock.uptimeMillis();
            // 启动 Service，但这次只会调用 onCreate 而不会调用 onStartCommand
            if (bringUpServiceLocked(s, service.getFlags(), callerFg, false,
                    permissionsReviewRequired) != null) {
                return 0;
            }
        }
        ...
        if (s.app != null && b.intent.received) {
            // 如果 Service 在运行中，直接调用 connected 方法
            c.conn.connected(s.name, b.intent.binder, false);
            ...
        } else if (!b.intent.requested) {
            // 从这里进去调用到 onBind
            requestServiceBindingLocked(s, b.intent, callerFg, false);
        }
        ...
    }

    private final boolean requestServiceBindingLocked(ServiceRecord r, IntentBindRecord i,
            boolean execInFg, boolean rebind) throws TransactionTooLargeException {
        ...
        try {
            // 埋 ANR 炸弹
            bumpServiceExecutingLocked(r, execInFg, "bind");
            ...
            // 调用到应用程序端
            r.app.thread.scheduleBindService(r, i.intent.getIntent(), rebind,
                    r.app.repProcState);
            ...
        } catch (TransactionTooLargeException e) {
            ...
            // 异常了，拆炸弹
            serviceDoneExecutingLocked(r, inDestroying, inDestroying);
            throw e;
        } catch (RemoteException e) {
            ...
            // 异常了，拆炸弹
            serviceDoneExecutingLocked(r, inDestroying, inDestroying);
            return false;
        }
        return true;
    }
```

### 客户端进程

#### ActivityThread.java

```java
public final class ActivityThread extends ClientTransactionHandler {

    private class ApplicationThread extends IApplicationThread.Stub {
      
        public final void scheduleBindService(IBinder token, Intent intent,
                boolean rebind, int processState) {
            updateProcessState(processState, false);
            BindServiceData s = new BindServiceData();
            s.token = token;
            s.intent = intent;
            s.rebind = rebind;
            sendMessage(H.BIND_SERVICE, s);
        }
      
    }
  
    class H extends Handler {

        public void handleMessage(Message msg) {
                ...
                case BIND_SERVICE:
                    handleBindService((BindServiceData)msg.obj);
                    break;
                ...
        }
      
    }
  
    private void handleBindService(BindServiceData data) {
        Service s = mServices.get(data.token);
        ...
        if (!data.rebind) {
            // 调用 onBind
            IBinder binder = s.onBind(data.intent);
            // 通知 AMS
            ActivityManager.getService().publishService(data.token, data.intent, binder);
        } else {
            // 调用 onRebind
            s.onRebind(data.intent);
            ActivityManager.getService().serviceDoneExecuting(data.token, SERVICE_DONE_EXECUTING_ANON, 0, 0);
        }
        ...
    }
  
}
```

### system_server 进程

#### ActivityManagerService.java

```java
    public void publishService(IBinder token, Intent intent, IBinder service) {
        ...
        mServices.publishServiceLocked((ServiceRecord)token, intent, service);
    }
```

#### ActiveServices.java

```java
    void publishServiceLocked(ServiceRecord r, Intent intent, IBinder service) {
        ...
        // 在上面的 ActiveServices::bindServiceLocked() 方法中，会创建 ConnectionRecord 访入 ServiceRecord::connections 中，在这里就算把他取出来
        for (int conni=r.connections.size()-1; conni>=0; conni--) {
            ArrayList<ConnectionRecord> clist = r.connections.valueAt(conni);
            for (int i=0; i<clist.size(); i++) {
                ConnectionRecord c = clist.get(i);
                if (!filter.equals(c.binding.intent.intent)) {
                    continue;
                }
                // 找到了，调用 connected 方法，这个 c.conn 其实就是客户端传来的 IServiceConnection
                c.conn.connected(r.name, service, false);
            }
        }
        serviceDoneExecutingLocked(r, mDestroyingServices.contains(r), false);
        ...
    }
```

### 客户端进程

开始分析 `IServiceConnection` 的来源，以及 调用 `connected()` 方法后的调用链。

在上面 [`ContextImpl::bindServiceCommon()`](#contextimpljava-1) 中，调用到 AMS 前，就创建了 `IServiceConnection` 实例。

#### ContextImpl.java

```java
    private boolean bindServiceCommon(Intent service, ServiceConnection conn, int flags, Handler
            handler, UserHandle user) {
        // 这里创建 IServiceConnection，传入我们调用 bindService 时传入的 ServiceConnection 对象
        IServiceConnection sd;
        sd = mPackageInfo.getServiceDispatcher(conn, getOuterContext(), handler, flags);
        ...
        // 调用到 AMS
        int res = ActivityManager.getService().bindService(
            mMainThread.getApplicationThread(), getActivityToken(), service,
            service.resolveTypeIfNeeded(getContentResolver()),
            sd, flags, getOpPackageName(), user.getIdentifier());
        ...
    }
```

#### LoadedApk.java

```java
public final class LoadedApk {    

    public final IServiceConnection getServiceDispatcher(ServiceConnection c,
            Context context, Handler handler, int flags) {
        synchronized (mServices) {
            LoadedApk.ServiceDispatcher sd = null;
            ArrayMap<ServiceConnection, LoadedApk.ServiceDispatcher> map = mServices.get(context);
            // 找到了已存在的 ServiceDispatcher 对象，直接返回
            if (map != null) {
                sd = map.get(c);
            }
            if (sd == null) {
                // 没找到，创建实例并放入表内
                sd = new ServiceDispatcher(c, context, handler, flags);
                if (map == null) {
                    map = new ArrayMap<>();
                    mServices.put(context, map);
                }
                map.put(c, sd);
            } else {
                // 检查上面找到的合法性
                sd.validate(context, handler);
            }
            return sd.getIServiceConnection();
        }
    }
  
    static final class ServiceDispatcher {
      
        ServiceDispatcher(ServiceConnection conn,
                Context context, Handler activityThread, int flags) {
            mIServiceConnection = new InnerConnection(this);
            mConnection = conn;
            ...
        }
      
        // 所以返回并传入 AMS 的其实是 InnerConnection 对象
        IServiceConnection getIServiceConnection() {
            return mIServiceConnection;
        }
      
        private static class InnerConnection extends IServiceConnection.Stub {
            final WeakReference<LoadedApk.ServiceDispatcher> mDispatcher;

            InnerConnection(LoadedApk.ServiceDispatcher sd) {
                mDispatcher = new WeakReference<LoadedApk.ServiceDispatcher>(sd);
            }
            
            // 所以最后调用 c.conn.connected() 其实是调用到这里
            public void connected(ComponentName name, IBinder service, boolean dead)
                    throws RemoteException {
                LoadedApk.ServiceDispatcher sd = mDispatcher.get();
                if (sd != null) {
                    // 又回到外部类
                    sd.connected(name, service, dead);
                }
            }
        }
      
        public void connected(ComponentName name, IBinder service, boolean dead) {
            if (mActivityThread != null) {
                // post 一个 RunConnection 到主线程的轮询中，最后会被执行，接下来看看 RunConnection 
                mActivityThread.post(new RunConnection(name, service, 0, dead));
            } else {
                doConnected(name, service, dead);
            }
        }
      
        // 不再是静态内部类了
        private final class RunConnection implements Runnable {
            
            public void run() {
                if (mCommand == 0) {
                     // 连接的时候，又会调用外部类 ServiceDispatcher 的 doConnected() 方法
                    doConnected(mName, mService, mDead);
                } else if (mCommand == 1) {
                    doDeath(mName, mService);
                }
            }

        }
      
        public void doConnected(ComponentName name, IBinder service, boolean dead) {
            ServiceDispatcher.ConnectionInfo old;
            ServiceDispatcher.ConnectionInfo info;

            synchronized (this) {
                ...
                // 看看有没有旧的连接
                old = mActiveConnections.get(name);
                // 旧的就是现在的，直接返回，不调用 onServiceConnected
                if (old != null && old.binder == service) {
                    return;
                }
                ...
            }
            // 断开旧的
            if (old != null) {
                mConnection.onServiceDisconnected(name);
            }
            ...
            if (service != null) {
                // 调用到 onServiceConnected() 这里就是我们开发的时候传入的部分了
                mConnection.onServiceConnected(name, service);
            }
            ...
        }      
      
    }
  
}
```

到这里，从我们调用 `bindService()` 开始到 `Service::onBind()` ，最后到 `ServiceConnection::onServiceConnected()` 的调用过程都分析结束了。

## ANR

在上面的流程中，都会调用 `ActiveSevices::bumpServiceExecutingLocked()` 方法；之后，异常或者正常，都会调用到 `ActivityManagerService::serviceDoneExecuting()` 方法；这两个就是 `Service ANR` 埋炸弹和拆炸弹的方法。

### 埋炸弹

#### ActiveServices.java

```java
    // fg 取决于 调用方进程 是否不为后台进程
    // 如在 ActiveServices::startServiceLocked() 方法中的 callerFg:
    // if (caller != null) {
    //    callerFg = callerApp.setSchedGroup != ProcessList.SCHED_GROUP_BACKGROUND;
    // } else {
    //    callerFg = true;
    // }
    private final void bumpServiceExecutingLocked(ServiceRecord r, boolean fg, String why) {
        ...
        long now = SystemClock.uptimeMillis();
        // r.executeNesting 每次进入这个方法都会 ++，调用 serviceDoneExecutingLocked 的时候会 --
        if (r.executeNesting == 0) {
            r.executeFg = fg;
            ...
            if (r.app != null) {
                r.app.executingServices.add(r);
                // r.app.execServicesFg 在 serviceDoneExecutingLocked 中才会被设置成 false
                r.app.execServicesFg |= fg;
                if (timeoutNeeded && r.app.executingServices.size() == 1) {
                    // 埋炸弹
                    scheduleServiceTimeoutLocked(r.app);
                }
            }
        } else if (r.app != null && fg && !r.app.execServicesFg) {
            r.app.execServicesFg = true;
            if (timeoutNeeded) {
                // 埋炸弹
                scheduleServiceTimeoutLocked(r.app);
            }
        }
        // 以上，executeNesting 和 execServicesFg 组成了一个过滤
        // 所以并不是每一次调用这个方法 都会埋一次炸弹
        r.executeFg |= fg;
        r.executeNesting++;
        r.executingStart = now;
    }

    void scheduleServiceTimeoutLocked(ProcessRecord proc) {
        if (proc.executingServices.size() == 0 || proc.thread == null) {
            return;
        }
        Message msg = mAm.mHandler.obtainMessage(
                ActivityManagerService.SERVICE_TIMEOUT_MSG);
        msg.obj = proc;
        // 发送延时消息，也就是埋炸弹，延时时间根据调用方进程是否为后台进程决定，是的话 200s，不是的话 20s
        mAm.mHandler.sendMessageDelayed(msg,
                proc.execServicesFg ? SERVICE_TIMEOUT : SERVICE_BACKGROUND_TIMEOUT);
    }

    static final int SERVICE_TIMEOUT = 20*1000;
    static final int SERVICE_BACKGROUND_TIMEOUT = SERVICE_TIMEOUT * 10;
```

### 拆炸弹

#### ActiveServices.java

```java
    private void serviceDoneExecutingLocked(ServiceRecord r, boolean inDestroying,
            boolean finishing) {
        r.executeNesting--;
        if (r.executeNesting <= 0) {
            if (r.app != null) {
                r.app.execServicesFg = false;
                r.app.executingServices.remove(r);
                if (r.app.executingServices.size() == 0) {
                   // 移除延时消息
                    mAm.mHandler.removeMessages(ActivityManagerService.SERVICE_TIMEOUT_MSG, r.app);
                }
                ...
            }
            r.executeFg = false;
            ...
        }
    }
```

### 炸弹爆炸

#### ActivityManagerService.java

```java
public class ActivityManagerService extends IActivityManager.Stub
        implements Watchdog.Monitor, BatteryStatsImpl.BatteryCallback {
 
      final class MainHandler extends Handler {
       
        public void handleMessage(Message msg) {
            ...
            case SERVICE_TIMEOUT_MSG: {
                mServices.serviceTimeout((ProcessRecord)msg.obj);
            } break;
            ...
        }
        
      }
  
}
```

#### ActiveServices.java

```java
    void serviceTimeout(ProcessRecord proc) {
        String anrMessage = null;

        synchronized(mAm) {
            if (proc.executingServices.size() == 0 || proc.thread == null) {
                return;
            }
            final long now = SystemClock.uptimeMillis();
            // 从现在开始往前数，得到会 ANR 的开始时间
            final long maxTime =  now -
                    (proc.execServicesFg ? SERVICE_TIMEOUT : SERVICE_BACKGROUND_TIMEOUT);
            ServiceRecord timeout = null;
            long nextTime = 0;
            // 遍历正在执行的 Services，找到第一个比在 maxTime 还早就开始的 Service，也就是 ANR 了的 Service 
            for (int i=proc.executingServices.size()-1; i>=0; i--) {
                ServiceRecord sr = proc.executingServices.valueAt(i);
                if (sr.executingStart < maxTime) {
                    timeout = sr;
                    break;
                }
                if (sr.executingStart > nextTime) {
                    nextTime = sr.executingStart;
                }
            }
            if (timeout != null && mAm.mLruProcesses.contains(proc)) {
                // dump ANR 信息
                StringWriter sw = new StringWriter();
                PrintWriter pw = new FastPrintWriter(sw, false, 1024);
                pw.println(timeout);
                timeout.dump(pw, "    ");
                pw.close();
                mLastAnrDump = sw.toString();
                // 延时清除全局变量 mLastAnrDump
                mAm.mHandler.removeCallbacks(mLastAnrDumpClearer);
                mAm.mHandler.postDelayed(mLastAnrDumpClearer, LAST_ANR_LIFETIME_DURATION_MSECS);
                anrMessage = "executing service " + timeout.shortName;
            } else {
                // 没找到，重新发一个延时消息，再埋一次炸弹
                Message msg = mAm.mHandler.obtainMessage(
                        ActivityManagerService.SERVICE_TIMEOUT_MSG);
                msg.obj = proc;
                mAm.mHandler.sendMessageAtTime(msg, proc.execServicesFg
                        ? (nextTime+SERVICE_TIMEOUT) : (nextTime + SERVICE_BACKGROUND_TIMEOUT));
            }
        }

        if (anrMessage != null) {
            // ANR 处理，dump traces.txt 文件、输出控制台日志、弹出未响应对话框
            mAm.mAppErrors.appNotResponding(proc, null, null, false, anrMessage);
        }
    }
```

