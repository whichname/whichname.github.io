---
title: Activity 渲染流程
tags: ["android-source"]
key: Render
---

我们刚开始学习安卓时，第一课就是在 `Activity` 的 `onCreate` 方法中，调用 `setContentView` 设置布局，且我们知道，在 `onResume` 时，画面才会渲染；所以要分析 `Activity` 的渲染流程，就要从这三部分入手。

<!--more-->

1. `Activity::onCreate` 阶段：初始化 `context ( ContextImpl 实例)`、`window ( PhoneWindow 实例)`、`windowManager ( WindowManagerImpl 单例)` 等；
2. `setContentView` 阶段：初始化 `DecorView`、`ContentParent`、加载布局等；
3. `Activity::onResume` 阶段：处理垂直同步、测量、布局、绘制（软件渲染或硬件渲染）等；

## 初始化

初始化发生在 `Activity::onCreate` 阶段，在这个过程中，应用会初始化 `context`、`window` 等；我们从 `ActivityThread::handleLaunchActivity` 开始看起。

#### ActivityThread.java

```java
public final class ActivityThread extends ClientTransactionHandler {   
    
    @Override
    public Activity handleLaunchActivity(ActivityClientRecord r,
            PendingTransactionActions pendingActions, Intent customIntent) {
        ...
        final Activity a = performLaunchActivity(r, customIntent);
        ...
    }
  
    private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {
        ...
        // 创建 context，是 ContextImpl 实例
        ContextImpl appContext = createBaseContextForActivity(r);
        ...
                Window window = null;
                if (r.mPendingRemoveWindow != null && r.mPreserveWindow) {
                    window = r.mPendingRemoveWindow;
                    r.mPendingRemoveWindow = null;
                    r.mPendingRemoveWindowManager = null;
                }
                appContext.setOuterContext(activity);
                // 调用 Activity::attach 方法
                activity.attach(appContext, this, getInstrumentation(), r.token,
                        r.ident, app, r.intent, r.activityInfo, title, r.parent,
                        r.embeddedID, r.lastNonConfigurationInstances, config,
                        r.referrer, r.voiceInteractor, window, r.configCallback);
        ...
    }

    private ContextImpl createBaseContextForActivity(ActivityClientRecord r) {
        ...
        ContextImpl appContext = ContextImpl.createActivityContext(
                this, r.packageInfo, r.activityInfo, r.token, displayId, r.overrideConfig);
        ...
        return appContext;
    }  
  
}  
```

#### Activity.java

```java
public class Activity extends ContextThemeWrapper
        implements LayoutInflater.Factory2,
        Window.Callback, KeyEvent.Callback,
        OnCreateContextMenuListener, ComponentCallbacks2,
        Window.OnWindowDismissedCallback, WindowControllerCallback,
        AutofillManager.AutofillClient {    

    final void attach(Context context, ActivityThread aThread,
            Instrumentation instr, IBinder token, int ident,
            Application application, Intent intent, ActivityInfo info,
            CharSequence title, Activity parent, String id,
            NonConfigurationInstances lastNonConfigurationInstances,
            Configuration config, String referrer, IVoiceInteractor voiceInteractor,
            Window window, ActivityConfigCallback activityConfigCallback) {
        ...
        // window 是 PhoneWindow 实例
        mWindow = new PhoneWindow(this, window, activityConfigCallback);
        ...
        // windowManager 实际上是 WindowManagerImpl 的单例
        mWindow.setWindowManager(
                (WindowManager)context.getSystemService(Context.WINDOW_SERVICE),
                mToken, mComponent.flattenToString(),
                (info.flags & ActivityInfo.FLAG_HARDWARE_ACCELERATED) != 0);
        ...
        mWindowManager = mWindow.getWindowManager();
        ...
    }
          
}          
```

#### ContextImpl.java

在这里看下 `ContextImpl::getSystemService` 方法：

```java
class ContextImpl extends Context {

    @Override
    public Object getSystemService(String name) {
        return SystemServiceRegistry.getSystemService(this, name);
    }
  
}  
```

#### SystemServiceRegistry.java

```java
final class SystemServiceRegistry { 

    public static Object getSystemService(ContextImpl ctx, String name) {
        ServiceFetcher<?> fetcher = SYSTEM_SERVICE_FETCHERS.get(name);
        return fetcher != null ? fetcher.getService(ctx) : null;
    }

    // SYSTEM_SERVICE_FETCHERS 是一个 HashMap
    private static final HashMap<String, ServiceFetcher<?>> SYSTEM_SERVICE_FETCHERS =
            new HashMap<String, ServiceFetcher<?>>();

    static {
        ...
        // 注册 WindowService，其实是 WindowManagerImpl 实例
        registerService(Context.WINDOW_SERVICE, WindowManager.class,
                new CachedServiceFetcher<WindowManager>() {
            @Override
            public WindowManager createService(ContextImpl ctx) {
                return new WindowManagerImpl(ctx);
            }});   
        ...
    }

}  
```

## 创建 DecorView、加载布局

接着我们到了 `Activity::setContentView` 方法中，调用这个方法时，我们需要传入自己的布局；在方法内，会创建 `DecorView`，并从中获取 `ContentParent`，然后再将我们的布局加载到 `ContentParent` 中。

#### Activity.java

```java
public class Activity extends ContextThemeWrapper
        implements LayoutInflater.Factory2,
        Window.Callback, KeyEvent.Callback,
        OnCreateContextMenuListener, ComponentCallbacks2,
        Window.OnWindowDismissedCallback, WindowControllerCallback,
        AutofillManager.AutofillClient {    
          
    public void setContentView(@LayoutRes int layoutResID) {
        // mWindow 就是 PhoneWindow 实例
        getWindow().setContentView(layoutResID);
        initWindowDecorActionBar();
    }

}          
```

#### PhoneWindow.java

```java
public class PhoneWindow extends Window implements MenuBuilder.Callback {

    @Override
    public void setContentView(int layoutResID) {
        ...
            // 初始化 DecorView、mContentParent 等
            installDecor();
        ...
            // 加载传入的布局文件到 mContentParent 中
            mLayoutInflater.inflate(layoutResID, mContentParent);
        ...
    }

    private void installDecor() {
        ...
            // 新建 DecorView
            mDecor = generateDecor(-1);
        ...
            // 从 DecorView 中获得 mContentParent
            mContentParent = generateLayout(mDecor);
        ...
    }


    protected DecorView generateDecor(int featureId) {
        ...
        return new DecorView(context, featureId, this, getAttributes());
    }

    protected ViewGroup generateLayout(DecorView decor) {
        ...
        // 看下面 findViewById ，所以其实 contentParent 是从 DecorView 中获取的布局
        ViewGroup contentParent = (ViewGroup)findViewById(ID_ANDROID_CONTENT);
        ...
        return contentParent;
    }

		// 在父类 Window.java 中
    public <T extends View> T findViewById(@IdRes int id) {
        return getDecorView().findViewById(id);
    }
  
}  
```

## 渲染

最后是在 `Activity::onResume` 阶段执行的渲染流程，这部分内容比较多；我们大体将其分为几部分：

1. 创建 `ViewRootImpl`，将 `DecorView` 的 `parent` 设置为 `ViewRootImpl`;
2. 调用 `ViewRootImpl::requestLayout` 方法，订阅垂直同步信号；
3. 收到垂直同步信号后，执行 `ViewRootImpl::performTraversals` 相关方法，进行硬件或软件渲染；

### 1. 创建 `ViewRootImpl`

#### ActivityThread.java

```java
public final class ActivityThread extends ClientTransactionHandler {   
 
    @Override
    public void handleResumeActivity(IBinder token, boolean finalStateRequest, boolean isForward,
            String reason) {
        ...
            // PhoneWindow
            r.window = r.activity.getWindow();
            // DecorView
            View decor = r.window.getDecorView();
        ...
            // WindowManagerImpl 实例
            ViewManager wm = a.getWindowManager();
        ...
                   // 调用 WindowManagerImpl::addView 方法
                    wm.addView(decor, l);
        ...
                r.activity.makeVisible();
        ...
    }  
  
}  
```

#### WindowManagerImpl.java

```java
public final class WindowManagerImpl implements WindowManager {
  
    private final WindowManagerGlobal mGlobal = WindowManagerGlobal.getInstance();  
 
    @Override
    public void addView(@NonNull View view, @NonNull ViewGroup.LayoutParams params) {
        applyDefaultToken(params);
        // 调用 WindowManagerGlobal::addView 方法
        mGlobal.addView(view, params, mContext.getDisplay(), mParentWindow);
    }  
  
}  
```

#### WindowManagerGlobal.java

```java
public final class WindowManagerGlobal {

    public void addView(View view, ViewGroup.LayoutParams params,
            Display display, Window parentWindow) {
        ...
        ViewRootImpl root;
        ...
            // 创建 ViewRootImpl 实例
            root = new ViewRootImpl(view.getContext(), display);
        ...
                // 调用 ViewRootImpl::setView 方法， view 是 DecorView
                root.setView(view, wparams, panelParentView);
        ...
    }
  
}  
```

#### ViewRootImpl.java

```java
public final class ViewRootImpl implements ViewParent,
        View.AttachInfo.Callbacks, ThreadedRenderer.DrawCallbacks {

    public void setView(View view, WindowManager.LayoutParams attrs, View panelParentView) {
        synchronized (this) {
            ...
                // 渲染，这个方法后面分析
                requestLayout();
            ...
                // view 是 DecorView，把 DecorView 的 mParent 设置为 ViewRootImpl
                view.assignParent(this);
            ...
        }
    }          
          
}          
```

#### View.java

```java
public class View implements Drawable.Callback, KeyEvent.Callback,
        AccessibilityEventSource {

    void assignParent(ViewParent parent) {
        ...
        mParent = parent;
        ...
    }
          
}          
```

至此，我们的 `view` 树的根节点最后变成了 `ViewRootImpl`；调用 `View::requestLayout`、`View::invalidate` 等，最后都会调用到 `ViewRootImpl` 中。

### 2. 订阅垂直同步信号

垂直同步信号简单地说，就是屏幕在显示每一帧的时候，发出一个信号通知系统渲染下一帧，这样就能最大化利用帧间间隔的时间来进行渲染，从而减少丢帧。

接下来我们开始分析上面 `ViewRootImpl::setView` 中的 `requestLayout`。

`requestLayout` 会调用 `scheduleTraversals` 方法，然后调用到编舞者类 `Choreographer`  的 `scheduleVsyncLocked` 方法，最后使用 `DisplayEventReceiver` 类的 `scheduleVsync` 方法订阅垂直同步信号；

为了保证渲染请求可以最快被执行，所以在订阅信号前，`ViewRootImpl` 会给 `Handler` 加一个同步屏障，而渲染请求是异步消息，就可以优先被处理。

#### ViewRootImpl.java

```java
public final class ViewRootImpl implements ViewParent,
        View.AttachInfo.Callbacks, ThreadedRenderer.DrawCallbacks {

    @Override
    public void requestLayout() {
        if (!mHandlingLayoutInLayoutRequest) {
            // 检查线程
            checkThread();
            mLayoutRequested = true;
            // 渲染
            scheduleTraversals();
        }
    }

    void scheduleTraversals() {
        if (!mTraversalScheduled) {
            mTraversalScheduled = true;
            // 同步屏障
            mTraversalBarrier = mHandler.getLooper().getQueue().postSyncBarrier();
            // 调用 Choreographer::postCallback 方法
            mChoreographer.postCallback(
                    Choreographer.CALLBACK_TRAVERSAL, mTraversalRunnable, null);
            ...
        }
    }
          
    final class TraversalRunnable implements Runnable {
        @Override
        public void run() {
            doTraversal();
        }
    }          
    final TraversalRunnable mTraversalRunnable = new TraversalRunnable();      
          
}          
```

#### Choreographer.java

```java
public final class Choreographer {
 
    public void postCallback(int callbackType, Runnable action, Object token) {
        postCallbackDelayed(callbackType, action, token, 0);
    }

    public void postCallbackDelayed(int callbackType,
            Runnable action, Object token, long delayMillis) {
        ...
        // 最后会调用这个方法
        postCallbackDelayedInternal(callbackType, action, token, delayMillis);
    }

    private void postCallbackDelayedInternal(int callbackType,
            Object action, Object token, long delayMillis) {
        synchronized (mLock) {
            final long now = SystemClock.uptimeMillis();
            final long dueTime = now + delayMillis;
            // 将 action, 也就是 TraversalRunnable 实例加入到队列中
            // 这个调用链中，callbackType 是 CALLBACK_TRAVERSAL
            mCallbackQueues[callbackType].addCallbackLocked(dueTime, action, token);

            if (dueTime <= now) {
                // 马上执行
                scheduleFrameLocked(now);
            } else {
                // 延时消息，最后也会执行到 scheduleFrameLocked
                Message msg = mHandler.obtainMessage(MSG_DO_SCHEDULE_CALLBACK, action);
                msg.arg1 = callbackType;
                msg.setAsynchronous(true);
                mHandler.sendMessageAtTime(msg, dueTime);
            }
        }
    }

    // 是否开启垂直同步，android 4.1 后引入
    private static final boolean USE_VSYNC = SystemProperties.getBoolean(
            "debug.choreographer.vsync", true);

    private void scheduleFrameLocked(long now) {
        if (!mFrameScheduled) {
            mFrameScheduled = true;
            // 使用垂直同步
            if (USE_VSYNC) {
                if (isRunningOnLooperThreadLocked()) {
                    // 当前线程，直接调用 scheduleVsyncLocked
                    scheduleVsyncLocked();
                } else {
                    // 跨线程，发送消息执行，最后也会执行到 scheduleVsyncLocked
                    Message msg = mHandler.obtainMessage(MSG_DO_SCHEDULE_VSYNC);
                    msg.setAsynchronous(true);
                    mHandler.sendMessageAtFrontOfQueue(msg);
                }
            } else {
                // 没开垂直同步，发送延时消息，执行
                final long nextFrameTime = Math.max(
                        mLastFrameTimeNanos / TimeUtils.NANOS_PER_MS + sFrameDelay, now);
                Message msg = mHandler.obtainMessage(MSG_DO_FRAME);
                msg.setAsynchronous(true);
                mHandler.sendMessageAtTime(msg, nextFrameTime);
            }
        }
    }

    private void scheduleVsyncLocked() {
        // mDisplayEventReceiver 是 FrameDisplayEventReceiver，scheduleVsync 是其父类的方法
        mDisplayEventReceiver.scheduleVsync();
    }  
  
}  
```

#### DisplayEventReceiver.java

```java
public abstract class DisplayEventReceiver {
 
    /**
     * 使 在下一次显示帧开始时，能收到垂直同步脉冲
     */
    public void scheduleVsync() {
        ...
            nativeScheduleVsync(mReceiverPtr);
        ...
    }

    // 当下一次显示帧开始时，会调用该方法
    @SuppressWarnings("unused")
    private void dispatchVsync(long timestampNanos, int builtInDisplayId, int frame) {
        // onVsync 在本类是空实现，得看子类的实现
        onVsync(timestampNanos, builtInDisplayId, frame);
    }  
  
}  
```

### 3. 收到垂直同步信号

当我们订阅垂直同步信号后，当信号产生时，`DisplayEventReceiver::dispatchVsync` 方法会被调用，然后是 `onVsync` 方法，这个方法在 `DisplayEventReceiver` 中是空实现，所以我们需要看 `Choreographer` 中的子类的实现；

#### Choreographer.java

```java
public final class Choreographer {
  
    private final class FrameDisplayEventReceiver extends DisplayEventReceiver
            implements Runnable {
     
        @Override
        public void onVsync(long timestampNanos, int builtInDisplayId, int frame) {
            ...
            // 发送异步消息，执行自己的 run 方法
            Message msg = Message.obtain(mHandler, this);
            msg.setAsynchronous(true);
            mHandler.sendMessageAtTime(msg, timestampNanos / TimeUtils.NANOS_PER_MS);
        }     
      
        @Override
        public void run() {
            mHavePendingVsync = false;
            // 调用 Choreographer 的 doFrame 方法
            doFrame(mTimestampNanos, mFrame);
        }      	
      
    }
  
    void doFrame(long frameTimeNanos, int frame) {
        ...
            mFrameInfo.markInputHandlingStart();
            doCallbacks(Choreographer.CALLBACK_INPUT, frameTimeNanos);

            mFrameInfo.markAnimationsStart();
            doCallbacks(Choreographer.CALLBACK_ANIMATION, frameTimeNanos);

            mFrameInfo.markPerformTraversalsStart();
            // ViewRootImpl::scheduleTraversals 添加的是 CALLBACK_TRAVERSAL 类型的回调
            doCallbacks(Choreographer.CALLBACK_TRAVERSAL, frameTimeNanos);

            doCallbacks(Choreographer.CALLBACK_COMMIT, frameTimeNanos);
        ...
    }

    void doCallbacks(int callbackType, long frameTimeNanos) {
        ...
            for (CallbackRecord c = callbacks; c != null; c = c.next) {
                // 执行，ViewRootImpl::scheduleTraversals 添加的是 TraversalRunnable 类型
                c.run(frameTimeNanos);
            }
        ...
    }  
  
}  
```

可以看到，最后会调用到 `ViewRootImpl` 传入的 `TraversalRunnable` 的实例。

#### ViewRootImpl.java

```java
public final class ViewRootImpl implements ViewParent,
        View.AttachInfo.Callbacks, ThreadedRenderer.DrawCallbacks {
          
    final class TraversalRunnable implements Runnable {
        @Override
        public void run() {
            // 调用 ViewRootImpl 的 doTraversal 方法
            doTraversal();
        }
    }
          
    void doTraversal() {
        if (mTraversalScheduled) {
            mTraversalScheduled = false;
            // 移除同步屏障
            mHandler.getLooper().getQueue().removeSyncBarrier(mTraversalBarrier);
            // 开始执行渲染
            performTraversals();
        }
    }          

    // 著名的 performTraversals 方法
    // 当我们调用 View::requestLayout、View::invalidate 方法时，最后都会调用到这里
    // 这个方法细节很多，而且网上有很多非常好的分析，这里就先不分析了
    private void performTraversals() {
      ...
      performMeasure(childWidthMeasureSpec, childHeightMeasureSpec);      
      ...
      performLayout(lp, mWidth, mHeight);      
      ...
      // 第一次调用不会执行该方法，而是再次调用 scheduleTraversals
      performDraw();
      ...
    }
          
    private void performDraw() {
        ...
        boolean canUseAsync = draw(fullRedrawNeeded);
        ...
    }
          
    private boolean draw(boolean fullRedrawNeeded) {
        ...
            // mThreadedRenderer 是在 ViewRootImpl::setView -> ViewRootImpl::enableHardwareAcceleration 方法中创建的, 当 Surface 创建后会进行初始化
            // 当开启硬件加速（4.0 默认开启）时，就会创建这个渲染线程
            if (mAttachInfo.mThreadedRenderer != null && mAttachInfo.mThreadedRenderer.isEnabled()) {
                ...
                // 开始硬件渲染
                mAttachInfo.mThreadedRenderer.draw(mView, mAttachInfo, this, callback);
            } else {
                ...
                // 软件渲染
                if (!drawSoftware(surface, mAttachInfo, xOffset, yOffset,
                        scalingRequired, dirty, surfaceInsets)) {
                    return false;
                }
            }
        ...
    }          
          
}          
```

`ViewRootImpl::TraversalRunnable` 被调用后，会先移除同步屏障，然后调用著名的 `performTraversals` 方法；其中会调用 `performDraw` 最后调用 `draw` 方法；在 `draw` 方法中，会进行硬件或者软件渲染。

### 4. 硬件渲染

硬件渲染在 Android  4.0 就默认开启了，指的是使用 GPU 进行渲染，Android 内部就是使用 OpenGL 或者 Vulkan 来进行 GPU 渲染的；

要分析 Android 的硬件渲染，首先要介绍相关的两个类：

- `ThreadedRenderer`： 渲染器，内部管理着 `RenderProxy`，完成具体的绘制，并发送给 `SurfaceFlinger` 进程进行合成；
- `RenderNode`：记录 `draw` 过程中的一系列图形操作，在具体绘制时能够进行重播；每个 `View` 都有自己的 `RenderNode`；

大体思路就是，在主线程中，通过对 `View` 树的 `draw` 方法的递归调用，记录下每一个绘制操作到 `RenderNode` 中；然后在渲染线程中，将每一个操作用 OpenGL 等重播一遍，绘制到 `Surface` 中，然后将绘制好的数据发送给 `SurfaceFlinger` 进行合成。

带着这个思路，我们继续看代码：

#### ThreadedRenderer.java

```java
public final class ThreadedRenderer {
 
    void draw(View view, AttachInfo attachInfo, DrawCallbacks callbacks,
            FrameDrawingCallback frameDrawingCallback) {
        ...
        // 记录绘制操作
        updateRootDisplayList(view, callbacks);
        ...
        // 该方法会将绘制操作进行重播，并实际绘制到 Surface 中，然后发送给 SurfaceFlinger
        int syncResult = nSyncAndDrawFrame(mNativeProxy, frameInfo, frameInfo.length);
        ...
    }  
  
    private void updateRootDisplayList(View view, DrawCallbacks callbacks) {
        ...
            // 创建用于记录绘制操作的 Canvas
            DisplayListCanvas canvas = mRootNode.start(mSurfaceWidth, mSurfaceHeight);
            ...
                // 将子 view 的绘制操作记录保存到当前的 Canvas 中
                canvas.drawRenderNode(view.updateDisplayListIfDirty());
                ...
                // 将 Canvas 保存的绘制操作记录保存到 RenderNode 中
                mRootNode.end(canvas);
        ...
    }  
  
}  
```

`ThreadedRenderer::draw` 方法做了两件事：

- 记录 `View` 树的绘制操作
- 将绘制操作重播进行实际绘制，并发送给 `SurfaceFlinger` 进行合成

我们这里主要分析第一步：

#### View.java

```java
public class View implements Drawable.Callback, KeyEvent.Callback,
        AccessibilityEventSource {

    public RenderNode updateDisplayListIfDirty() {
        // 每个 view 都有一个 RenderNode
        final RenderNode renderNode = mRenderNode;
        ...
        if ((mPrivateFlags & PFLAG_DRAWING_CACHE_VALID) == 0
                || !renderNode.isValid()
                || (mRecreateDisplayList)) {
            // 当前 view 不需要重绘，只需要告诉子 view 需要的话重绘他们自己
            if (renderNode.isValid()
                    && !mRecreateDisplayList) {
                mPrivateFlags |= PFLAG_DRAWN | PFLAG_DRAWING_CACHE_VALID;
                mPrivateFlags &= ~PFLAG_DIRTY_MASK;
                // 分发更新 RenderNode, ViewGroup 重写
                dispatchGetDisplayList();
                return renderNode;
            }
            // 当前 view 需要重绘
            ...
            // 创建 DisplayListCanvas
            final DisplayListCanvas canvas = renderNode.start(width, height);
            try {
                if (layerType == LAYER_TYPE_SOFTWARE) {
                    ...
                } else {
                    ...
                    if ((mPrivateFlags & PFLAG_SKIP_DRAW) == PFLAG_SKIP_DRAW) {
                        // 分发绘制
                        dispatchDraw(canvas);
                        ...
                    } else {
                        // 绘制自己
                        draw(canvas);
                    }
                }
            } finally {
                // 更新到 RenderNode 中
                renderNode.end(canvas);
                ...
            }
        } else {
            ...
        }
        return renderNode;
    }     
          
    public void draw(Canvas canvas) {
        ...
        /*
         * Draw traversal performs several drawing steps which must be executed
         * in the appropriate order:
         *
         *      1. Draw the background        
         *      2. If necessary, save the canvas' layers to prepare for fading
         *      3. Draw view's content
         *      4. Draw children
         *      5. If necessary, draw the fading edges and restore layers
         *      6. Draw decorations (scrollbars for instance)
         *
         *      1. 画背景         
         *      2. 需要的话，保存图层
         *      3. 绘制内容, 调用 onDraw
         *      4. 绘制孩子，调用 dispatchDraw   
         *      5. 需要的话，绘制边缘褪色（类似于阴影效果）并恢复图层
         *      6. 绘制装饰，如滚动条             
         *
         *      后面的注释其实还有个 step 7
         *      7. Step 7, draw the default focus highlight
         *      7. 绘制高亮
         */
        ...
    }
          
    protected void dispatchGetDisplayList() {}
          
    protected void dispatchDraw(Canvas canvas) {}          
          
}          
```

 `View::updateDisplayListIfDirty` 方法要么就是调用 `dispatchGetDisplayList` 或 `dispatchDraw` 绘制子类，要么就是调用 `draw` 方法绘制自身和子类；

如果当前 `View` 不需要重绘，则调用 `dispatchGetDisplayList` 更新子 `View` 的 `DisplayList`；

其中 `dispatchGetDisplayList` 和 `dispatchDraw` 都是 `ViewGroup` 的实现。

#### ViewGroup.java

```java
public abstract class ViewGroup extends View implements ViewParent, ViewManager {
  
    protected void dispatchGetDisplayList() {
        final int count = mChildrenCount;
        final View[] children = mChildren;
        for (int i = 0; i < count; i++) {
            final View child = children[i];
            if (((child.mViewFlags & VISIBILITY_MASK) == VISIBLE || child.getAnimation() != null)) {
                // 更新子 view 的 DisplayList
                recreateChildDisplayList(child);
            }
        }
        ...
    }
  
    private void recreateChildDisplayList(View child) {
        child.mRecreateDisplayList = (child.mPrivateFlags & PFLAG_INVALIDATED) != 0;
        child.mPrivateFlags &= ~PFLAG_INVALIDATED;
        // 又调用到 View::updateDisplayListIfDirty 方法
        child.updateDisplayListIfDirty();
        child.mRecreateDisplayList = false;
    }
  
    protected void dispatchDraw(Canvas canvas) {
        ...
        for (int i = 0; i < childrenCount; i++) {
            ...
            if ((child.mViewFlags & VISIBILITY_MASK) == VISIBLE || child.getAnimation() != null) {
                // 绘制子 view
                more |= drawChild(canvas, child, drawingTime);
            }
        }
        ...
    }  
  
    protected boolean drawChild(Canvas canvas, View child, long drawingTime) {
        // 又调用到了 draw 方法
        return child.draw(canvas, this, drawingTime);
    }  
  
}  
```

可以看到，最后又回到了 `updateDisplayListIfDirty` 和 `draw` 方法，从而完成整个 `View` 树的绘制。

### 5. 软件渲染

软件渲染就是使用 `CPU` 进行渲染，在 Android 底层，使用的是  Skia 进行 `CPU` 渲染的。

上面我们看到，如果是软件渲染，走的是 `ViewRootImpl::drawSoftware` 方法。

#### ViewRootImpl.java

```java
public final class ViewRootImpl implements ViewParent,
        View.AttachInfo.Callbacks, ThreadedRenderer.DrawCallbacks {

    private boolean drawSoftware(Surface surface, AttachInfo attachInfo, int xoff, int yoff,
            boolean scalingRequired, Rect dirty, Rect surfaceInsets) {
        final Canvas canvas;
        ...
            // 获得 canvas
            canvas = mSurface.lockCanvas(dirty);
        ...
        try {
                ...
                // 绘制
                mView.draw(canvas);
                ...
        } finally {
                ...
                // 释放 canvas 并发送
                surface.unlockCanvasAndPost(canvas);
                ...
        }
        ...
    }          
          
}          
```

可以看到，如果是软件渲染，会直接从 `Surface` 中获得 `canvas`，然后走 `View::draw` 方法将 `View` 树直接绘制到 `Surface` 中，然后发送给 `SurfaceFlinger` 进行合成。

`Surface` 中含有 `buffer` 队列，我们每次要绘制的时候，就从中获得一个 `buffer` 进行绘制，绘制结束后又塞入队列；相当于是画面的生成者，而消费者是 `SurfaceFlinger` 进程，他会取到绘制好的 `buffer` 进行合成，等合成后，再释放给我们。

## 总结

其实整个流程，还有非常多的细节，每个细节都有很多很好的分析文章，在这里推荐几篇我看到的好文。

 [Android 系统架构 —— View 的硬件渲染](https://sharrychoo.github.io/blog/android-source/graphic-draw-hardware)

[“终于懂了” 系列：Android屏幕刷新机制—VSync、Choreographer 全面理解！](https://juejin.cn/post/6863756420380196877)

[从零开始仿写一个抖音App——Android绘制机制以及Surface家族源码全解析](https://juejin.cn/post/6844903777334460430)

