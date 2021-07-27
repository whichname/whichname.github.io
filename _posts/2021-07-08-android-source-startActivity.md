---
title: Activity 启动流程
tags: ["android-source"]
key: startActivity
---

<!--more-->

Activity 的启动流程其实看了几遍，但是发现容易忘，所以在这里记录一下调用链，方便以后回顾。

本次分析基于 Android Api 28.

## 客户端进程

#### Activity.java

```java
    @Override
    public void startActivity(Intent intent) {
        this.startActivity(intent, null);
    }

    @Override
    public void startActivity(Intent intent, @Nullable Bundle options) {
        if (options != null) {
            startActivityForResult(intent, -1, options);
        } else {
            startActivityForResult(intent, -1);
        }
    }

    public void startActivityForResult(@RequiresPermission Intent intent, int requestCode,
            @Nullable Bundle options) {
      	...
        Instrumentation.ActivityResult ar =
                mInstrumentation.execStartActivity(
                    this, mMainThread.getApplicationThread(), mToken, this,
                    intent, requestCode, options);
      	...
    }
```

#### Instrumentation.java

```java
    public ActivityResult execStartActivity(
            Context who, IBinder contextThread, IBinder token, Activity target,
            Intent intent, int requestCode, Bundle options) {
            ...
            int result = ActivityManager.getService()
                .startActivity(whoThread, who.getBasePackageName(), intent,
                        intent.resolveTypeIfNeeded(who.getContentResolver()),
                        token, target != null ? target.mEmbeddedID : null,
                        requestCode, 0, null, options);
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

## system_server 进程

#### ActivityManagerService.java

```java
    @Override
    public final int startActivity(IApplicationThread caller, String callingPackage,
            Intent intent, String resolvedType, IBinder resultTo, String resultWho, int requestCode,
            int startFlags, ProfilerInfo profilerInfo, Bundle bOptions) {
        return startActivityAsUser(caller, callingPackage, intent, resolvedType, resultTo,
                resultWho, requestCode, startFlags, profilerInfo, bOptions,
                UserHandle.getCallingUserId());
    }

    @Override
    public final int startActivityAsUser(IApplicationThread caller, String callingPackage,
            Intent intent, String resolvedType, IBinder resultTo, String resultWho, int requestCode,
            int startFlags, ProfilerInfo profilerInfo, Bundle bOptions, int userId) {
        return startActivityAsUser(caller, callingPackage, intent, resolvedType, resultTo,
                resultWho, requestCode, startFlags, profilerInfo, bOptions, userId,
                true /*validateIncomingUser*/);
    }

    public final int startActivityAsUser(IApplicationThread caller, String callingPackage,
            Intent intent, String resolvedType, IBinder resultTo, String resultWho, int requestCode,
            int startFlags, ProfilerInfo profilerInfo, Bundle bOptions, int userId,
            boolean validateIncomingUser) {
        ...
        return mActivityStartController.obtainStarter(intent, "startActivityAsUser")
                .setCaller(caller)
                .setCallingPackage(callingPackage)
                .setResolvedType(resolvedType)
                .setResultTo(resultTo)
                .setResultWho(resultWho)
                .setRequestCode(requestCode)
                .setStartFlags(startFlags)
                .setProfilerInfo(profilerInfo)
                .setActivityOptions(bOptions)
                .setMayWait(userId)
                .execute();
    }
```

#### ActivityStarter.java

```java
    ActivityStarter setMayWait(int userId) {
        mRequest.mayWait = true;
        mRequest.userId = userId;

        return this;
    }

    int execute() {
        try {
            if (mRequest.mayWait) {
              	// 上面调用了 setMayWait 方法将 mayWait 设成了 true，所以走这里
                return startActivityMayWait(mRequest.caller, mRequest.callingUid,
                        mRequest.callingPackage, mRequest.intent, mRequest.resolvedType,
                        mRequest.voiceSession, mRequest.voiceInteractor, mRequest.resultTo,
                        mRequest.resultWho, mRequest.requestCode, mRequest.startFlags,
                        mRequest.profilerInfo, mRequest.waitResult, mRequest.globalConfig,
                        mRequest.activityOptions, mRequest.ignoreTargetSecurity, mRequest.userId,
                        mRequest.inTask, mRequest.reason,
                        mRequest.allowPendingRemoteAnimationRegistryLookup);
            } else {
                return startActivity(mRequest.caller, mRequest.intent, mRequest.ephemeralIntent,
                        mRequest.resolvedType, mRequest.activityInfo, mRequest.resolveInfo,
                        mRequest.voiceSession, mRequest.voiceInteractor, mRequest.resultTo,
                        mRequest.resultWho, mRequest.requestCode, mRequest.callingPid,
                        mRequest.callingUid, mRequest.callingPackage, mRequest.realCallingPid,
                        mRequest.realCallingUid, mRequest.startFlags, mRequest.activityOptions,
                        mRequest.ignoreTargetSecurity, mRequest.componentSpecified,
                        mRequest.outActivity, mRequest.inTask, mRequest.reason,
                        mRequest.allowPendingRemoteAnimationRegistryLookup);
            }
        } finally {
            onExecutionComplete();
        }
    }


    private int startActivityMayWait(IApplicationThread caller, int callingUid,
            String callingPackage, Intent intent, String resolvedType,
            IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
            IBinder resultTo, String resultWho, int requestCode, int startFlags,
            ProfilerInfo profilerInfo, WaitResult outResult,
            Configuration globalConfig, SafeActivityOptions options, boolean ignoreTargetSecurity,
            int userId, TaskRecord inTask, String reason,
            boolean allowPendingRemoteAnimationRegistryLookup) {
            ...
            int res = startActivity(caller, intent, ephemeralIntent, resolvedType, aInfo, rInfo,
                    voiceSession, voiceInteractor, resultTo, resultWho, requestCode, callingPid,
                    callingUid, callingPackage, realCallingPid, realCallingUid, startFlags, options,
                    ignoreTargetSecurity, componentSpecified, outRecord, inTask, reason,
                    allowPendingRemoteAnimationRegistryLookup);
            ...
    }

    private int startActivity(IApplicationThread caller, Intent intent, Intent ephemeralIntent,
            String resolvedType, ActivityInfo aInfo, ResolveInfo rInfo,
            IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
            IBinder resultTo, String resultWho, int requestCode, int callingPid, int callingUid,
            String callingPackage, int realCallingPid, int realCallingUid, int startFlags,
            SafeActivityOptions options, boolean ignoreTargetSecurity, boolean componentSpecified,
            ActivityRecord[] outActivity, TaskRecord inTask, String reason,
            boolean allowPendingRemoteAnimationRegistryLookup) {
        ...
        mLastStartActivityResult = startActivity(caller, intent, ephemeralIntent, resolvedType,
                aInfo, rInfo, voiceSession, voiceInteractor, resultTo, resultWho, requestCode,
                callingPid, callingUid, callingPackage, realCallingPid, realCallingUid, startFlags,
                options, ignoreTargetSecurity, componentSpecified, mLastStartActivityRecord,
                inTask, allowPendingRemoteAnimationRegistryLookup);
        ...
    }

    private int startActivity(IApplicationThread caller, Intent intent, Intent ephemeralIntent,
            String resolvedType, ActivityInfo aInfo, ResolveInfo rInfo,
            IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
            IBinder resultTo, String resultWho, int requestCode, int callingPid, int callingUid,
            String callingPackage, int realCallingPid, int realCallingUid, int startFlags,
            SafeActivityOptions options,
            boolean ignoreTargetSecurity, boolean componentSpecified, ActivityRecord[] outActivity,
            TaskRecord inTask, boolean allowPendingRemoteAnimationRegistryLookup) {
        ...
        ActivityRecord r = new ActivityRecord(mService, callerApp, callingPid, callingUid,
                callingPackage, intent, resolvedType, aInfo, mService.getGlobalConfiguration(),
                resultRecord, resultWho, requestCode, componentSpecified, voiceSession != null,
                mSupervisor, checkedOptions, sourceRecord);
        ...
        return startActivity(r, sourceRecord, voiceSession, voiceInteractor, startFlags,
                true /* doResume */, checkedOptions, inTask, outActivity);
    }


    private int startActivity(final ActivityRecord r, ActivityRecord sourceRecord,
                IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
                int startFlags, boolean doResume, ActivityOptions options, TaskRecord inTask,
                ActivityRecord[] outActivity) {
            ...
            result = startActivityUnchecked(r, sourceRecord, voiceSession, voiceInteractor,
                    startFlags, doResume, options, inTask, outActivity);
            ...
    }

    private int startActivityUnchecked(final ActivityRecord r, ActivityRecord sourceRecord,
            IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
            int startFlags, boolean doResume, ActivityOptions options, TaskRecord inTask,
            ActivityRecord[] outActivity) {
        // doResume 在上面传过来是 true，这个方法会把 mDoResume 设置成 true
        setInitialState(r, options, inTask, doResume, startFlags, sourceRecord, voiceSession,
                voiceInteractor);
        ...  
        if (mDoResume) {
                ...
                mSupervisor.resumeFocusedStackTopActivityLocked(mTargetStack, mStartActivity,
                        mOptions);
                ...
        }
        ...
    }
```

#### ActivityStackSupervisor.java

```java
    boolean resumeFocusedStackTopActivityLocked(
            ActivityStack targetStack, ActivityRecord target, ActivityOptions targetOptions) {
        ...
        if (targetStack != null && isFocusedStack(targetStack)) {
            return targetStack.resumeTopActivityUncheckedLocked(target, targetOptions);
        }
        ...
    }
```

#### ActivityStack.java

```java
    boolean resumeTopActivityUncheckedLocked(ActivityRecord prev, ActivityOptions options) {
            ...
            result = resumeTopActivityInnerLocked(prev, options);
            ...
    }

    private boolean resumeTopActivityInnerLocked(ActivityRecord prev, ActivityOptions options) {
        ...
        if (mResumedActivity != null) {
            ...
            // 如果当前有 Resumed 状态的 activity，会先 pause 他
            // 等 pause 完，会重新进入该方法，这时 mResumedActivity 已经是 null 了
            // 所以切换 activity 的时候，oldActivity 的 onPause 会先调用，之后才是 newActivity 的 onCreate、onStart、onResume，然后又到 oldActivity 的 onStop
            pausing |= startPausingLocked(userLeaving, false, next, false);
        }
        ...
        if (prev != null && prev != next) {
            // 能直接复用 activity，直接 resume
            ...
        } else {
            ...
            mStackSupervisor.startSpecificActivityLocked(next, true, true);
            ...
        }
        ...
    }
```

#### ActivityStackSupervisor.java

```java
    void startSpecificActivityLocked(ActivityRecord r,
            boolean andResume, boolean checkConfig) {
        ...
        if (app != null && app.thread != null) {
                ...
                realStartActivityLocked(r, app, andResume, checkConfig);
                return;
                ...
        }
        // 进程为空，先创建进程
        mService.startProcessLocked(r.processName, r.info.applicationInfo, true, 0,
                "activity", r.intent.getComponent(), false, false, true);
    }

    final boolean realStartActivityLocked(ActivityRecord r, ProcessRecord app,
            boolean andResume, boolean checkConfig) throws RemoteException {
                ...
                final ClientTransaction clientTransaction = ClientTransaction.obtain(app.thread,
                        r.appToken);
                // LaunchActivityItem
                clientTransaction.addCallback(LaunchActivityItem.obtain(new Intent(r.intent),
                        System.identityHashCode(r), r.info,
                        mergedConfiguration.getGlobalConfiguration(),
                        mergedConfiguration.getOverrideConfiguration(), r.compat,
                        r.launchedFromPackage, task.voiceInteractor, app.repProcState, r.icicle,
                        r.persistentState, results, newIntents, mService.isNextTransitionForward(),
                        profilerInfo));
                // andResume 是 true，所以会同时设置 ResumeActivityItem
                if (andResume) {
                    lifecycleItem = ResumeActivityItem.obtain(mService.isNextTransitionForward());
                } else {
                    lifecycleItem = PauseActivityItem.obtain();
                }
                // 这里 LaunchActivityItem 是调用 addCallback 加入的
                // ResumeActivityItem 是调用 setLifecycleStateRequest 设置的
                // execute 的时候，会先执行所有的 callback，然后才是 lifecycleStateRequest      
                clientTransaction.setLifecycleStateRequest(lifecycleItem);
                mService.getLifecycleManager().scheduleTransaction(clientTransaction);
                ...
    }
```

#### ClientLifecycleManager.java

```java
    void scheduleTransaction(ClientTransaction transaction) throws RemoteException {
        ...
        transaction.schedule();
        ...
    }
```

#### ClientTransaction.java

```java
    public void schedule() throws RemoteException {
        // mClient 就是目标进程的 ApplicationThread 代理
        mClient.scheduleTransaction(this);
    }
```

## 客户端进程

#### ActivityThread.java

```java
public final class ActivityThread extends ClientTransactionHandler {

    private class ApplicationThread extends IApplicationThread.Stub {
      
        public void scheduleTransaction(ClientTransaction transaction) throws RemoteException {
            // 这里其实会调用到 ActivityThread 的父类 ClientTransactionHandler
            ActivityThread.this.scheduleTransaction(transaction);
        }
      
    }
  
}
```

#### ClientTransactionHandler.java

```java
    void scheduleTransaction(ClientTransaction transaction) {
        transaction.preExecute(this);
        // 发送 handler 消息到 ActivityThread.H
        sendMessage(ActivityThread.H.EXECUTE_TRANSACTION, transaction);
    }
```

#### ActivityThread.java

```java
public final class ActivityThread extends ClientTransactionHandler {
  
    class H extends Handler {

        public void handleMessage(Message msg) {
                ...
                case EXECUTE_TRANSACTION:
                    final ClientTransaction transaction = (ClientTransaction) msg.obj;
                    mTransactionExecutor.execute(transaction);
                    break;
                ...
        }
    }
  
}
```

#### TransactionExecutor.java

```java
    public void execute(ClientTransaction transaction) {
        ...
        // 先执行所有的 callbacks
        executeCallbacks(transaction);
        // 再执行 lifecycleState
        executeLifecycleState(transaction);
        ...
    }

    public void executeCallbacks(ClientTransaction transaction) {
        ...
        // 遍历执行
        final int size = callbacks.size();
        for (int i = 0; i < size; ++i) {
            final ClientTransactionItem item = callbacks.get(i);
            ...
            // 这里的 item 就是 LaunchActivityItem 
            // mTransactionHandler 是初始化传进来的，就是 ActivityThread 对象
            item.execute(mTransactionHandler, token, mPendingActions);
            item.postExecute(mTransactionHandler, token, mPendingActions);
            ...
        }
    }
```

#### LaunchActivityItem.java

```java
    public void execute(ClientTransactionHandler client, IBinder token,
            PendingTransactionActions pendingActions) {
        ...
        ActivityClientRecord r = new ActivityClientRecord(token, mIntent, mIdent, mInfo,
                mOverrideConfig, mCompatInfo, mReferrer, mVoiceInteractor, mState, mPersistentState,
                mPendingResults, mPendingNewIntents, mIsForward,
                mProfilerInfo, client);
        // client 就是 ActivityThread 
        client.handleLaunchActivity(r, pendingActions, null /* customIntent */);
        ...
    }
```

#### ActivityThread.java

```java
    public Activity handleLaunchActivity(ActivityClientRecord r,
            PendingTransactionActions pendingActions, Intent customIntent) {
        ...
        final Activity a = performLaunchActivity(r, customIntent);
        ...
    }

    private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {
            ...
            // 创建 activity 实例
            java.lang.ClassLoader cl = appContext.getClassLoader();
            activity = mInstrumentation.newActivity(
                    cl, component.getClassName(), r.intent);
            ...
                // attach
                activity.attach(appContext, this, getInstrumentation(), r.token,
                        r.ident, app, r.intent, r.activityInfo, title, r.parent,
                        r.embeddedID, r.lastNonConfigurationInstances, config,
                        r.referrer, r.voiceInteractor, window, r.configCallback);
                ...
                // onCreate
                if (r.isPersistable()) {
                    mInstrumentation.callActivityOnCreate(activity, r.state, r.persistentState);
                } else {
                    mInstrumentation.callActivityOnCreate(activity, r.state);
                }
                ...
                // 设置当前状态为 ON_CREATE
                r.setState(ON_CREATE);
                ...
    }
```

#### Instrumentation.java

```java
    public Activity newActivity(ClassLoader cl, String className,
            Intent intent)
            throws InstantiationException, IllegalAccessException,
            ClassNotFoundException {
        String pkg = intent != null && intent.getComponent() != null
                ? intent.getComponent().getPackageName() : null;
        return getFactory(pkg).instantiateActivity(cl, className, intent);
    }
```

#### AppComponentFactory.java

```java
    public @NonNull Activity instantiateActivity(@NonNull ClassLoader cl, @NonNull String className,
            @Nullable Intent intent)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException {
        return (Activity) cl.loadClass(className).newInstance();
    }

    public void callActivityOnCreate(Activity activity, Bundle icicle) {
        prePerformCreate(activity);
        activity.performCreate(icicle);
        postPerformCreate(activity);
    }
```

#### Activity.java

```java
    final void performCreate(Bundle icicle) {
        performCreate(icicle, null);
    }

    final void performCreate(Bundle icicle, PersistableBundle persistentState) {
        ...
        // 调用 onCreate 方法
        if (persistentState != null) {
            onCreate(icicle, persistentState);
        } else {
            onCreate(icicle);
        }
        ...
    }
```

以上就是调用到 `Activity::onCreate()` 的调用链，接下来，继续分析 `Activity::onStart()` 和 `Activity::onResume()` 的调用链。

### Activity::onStart()

上面 [ `TransactionExecutor::execute()`](#transactionexecutorjava) 方法中，会先调用 `executeCallbacks()` 执行 `LaunchActivityItem`，最后到 `Activity::attach()` 和 `Activity::onCreate()`; 然后调用 `executeLifecycleState` :

#### TransactionExecutor.java

```java
    private void executeLifecycleState(ClientTransaction transaction) {
        final ActivityLifecycleItem lifecycleItem = transaction.getLifecycleStateRequest();
        ...
        // 这里会根据 activity 的当前状态和目标状态，按需要去执行对应的生命周期方法，比如这里最后会调用 onStart
        // lifecycleItem 就是 ResumeActivityItem , lifecycleItem.getTargetState() 就是 ON_RESUME
        cycleToPath(r, lifecycleItem.getTargetState(), true);
        // 执行 ResumeActivityItem
        lifecycleItem.execute(mTransactionHandler, token, mPendingActions);
        ...
    }

    private void cycleToPath(ActivityClientRecord r, int finish,
            boolean excludeLastState) {
        // 在上面的 ActivityThread::performLaunchActivity() 中，会调用 ActivityClientRecord::setState(ON_CREATE) 方法设置状态
        // 所以这里是 ON_CREATE
        final int start = r.getLifecycleState();
        // start 是 ON_CREATE, finish 是 ON_RESUME
        final IntArray path = mHelper.getLifecyclePath(start, finish, excludeLastState);
        // 这里最后会调用 Activity::onStart()
        performLifecycleSequence(r, path);
    }
```

#### ActivityLifecycleItem.java

```java
    // 各个状态的定义
    public static final int UNDEFINED = -1;
    public static final int PRE_ON_CREATE = 0;
    public static final int ON_CREATE = 1;
    public static final int ON_START = 2;
    public static final int ON_RESUME = 3;
    public static final int ON_PAUSE = 4;
    public static final int ON_STOP = 5;
    public static final int ON_DESTROY = 6;
    public static final int ON_RESTART = 7;
```

#### TransactionExecutorHelper.java

```java
    public IntArray getLifecyclePath(int start, int finish, boolean excludeLastState) {
        ...
        mLifecycleSequence.clear();
        if (finish >= start) {
            // 这里 start 是 ON_CREATE = 1, finish 是 ON_RESUME = 3，所以 mLifecycleSequence 变成 [2, 3]
            for (int i = start + 1; i <= finish; i++) {
                mLifecycleSequence.add(i);
            }
        } else {
            ...
        }
        // excludeLastState 传入是 true，会移除最后一个，最终 mLifecycleSequence 是 [ 2 ]，也就是 [ ON_START ]
        if (excludeLastState && mLifecycleSequence.size() != 0) {
            mLifecycleSequence.remove(mLifecycleSequence.size() - 1);
        }
        return mLifecycleSequence;
    }
```

#### TransactionExecutor.java

```java
    // 继续看这个方法，传入的 path 是 [ ON_START ]
    private void performLifecycleSequence(ActivityClientRecord r, IntArray path) {
        final int size = path.size();
        for (int i = 0, state; i < size; i++) {
            state = path.get(i);
            switch (state) {
                ...
                case ON_START:
                    // 上面说了，mTransactionHandler 是构造时传入的 ActivityThread 对象
                    mTransactionHandler.handleStartActivity(r, mPendingActions);
                    break;
                ...
            }
        }
    }
```

#### ActivityThread.java

```java
    public void handleStartActivity(ActivityClientRecord r,
            PendingTransactionActions pendingActions) {
        ...
        activity.performStart("handleStartActivity");
        // 设置当前状态为 ON_START
        r.setState(ON_START);
        ...
    }
```

#### Activity.java

```java
    final void performStart(String reason) {
        ...
        mInstrumentation.callActivityOnStart(this);
        ...
    }
```

#### Instrumentation.java

```java
    public void callActivityOnStart(Activity activity) {
        // 调用 onStart
        activity.onStart();
    }
```

### Activity::onResume()

接下来继续看 [ `TransactionExecutor::executeLifecycleState()`](#transactionexecutorjava-1) ,  其中 `cycleToPath()` 方法会调用到 `Activity::onStart()` ，而 `lifecycleItem.execute()` 执行的是 `ResumeActivityItem::execute()` 方法：

#### ResumeActivityItem.java

```java
    public void execute(ClientTransactionHandler client, IBinder token,
            PendingTransactionActions pendingActions) {
        ...
        // client 就是 ActivityThread
        client.handleResumeActivity(token, true /* finalStateRequest */, mIsForward,
                "RESUME_ACTIVITY");
        ...
    }
```

#### ActivityThread.java

```java
    public void handleResumeActivity(IBinder token, boolean finalStateRequest, boolean isForward,
            String reason) {
        ...
        final ActivityClientRecord r = performResumeActivity(token, finalStateRequest, reason);
        if (r == null) {
            return;
        }
        ...
        final Activity a = r.activity;
        ...
        // 创建 ViewRootImpl 等渲染流程
        if (r.window == null && !a.mFinished && willBeVisible) {
            r.window = r.activity.getWindow();
            View decor = r.window.getDecorView();
            decor.setVisibility(View.INVISIBLE);
            ViewManager wm = a.getWindowManager();
            WindowManager.LayoutParams l = r.window.getAttributes();
            a.mDecor = decor;
            ...
            wm.addView(decor, l);
            ...
            }
        }
        ...
    }

    public ActivityClientRecord performResumeActivity(IBinder token, boolean finalStateRequest,
            String reason) {
        ...
        r.activity.performResume(r.startsNotResumed, reason);
        ...
    }
```

#### Activity.java

```java
    final void performResume(boolean followedByPause, String reason) {
        ...
        mInstrumentation.callActivityOnResume(this);
        ...
    }
```

#### Instrumentation.java

```java
    public void callActivityOnResume(Activity activity) {
        activity.mResumed = true;
        activity.onResume();
        ...
    }
```

