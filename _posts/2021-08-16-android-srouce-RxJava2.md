---
title: RxJava2 源码简析
tags: ["android-source"]
key: RxJava2
---

`Observable` 内部有许多静态方法（操作符），比如我们常用的 `create`、 `map`、`flatmap` 等，调用这些静态方法，会返回操作符对应的  `Observable` 子类，比如 `ObservableCreate`、 `ObservableMap`、`ObservableFlatMap` 等；同时，新的 `Observable` 子类会将调用方保存到 `source` 变量中；

最后我们会调用 `subscribe` 方法，传入 `Observer`，该方法内部会调用到  `Observable` 子类的 `subscribeActual` 方法；在 `subscribeActual` 方法中，通过 `source::subscribe` 来调用上一个 `Observable` 子类的 `subscribe` 方法，传入自己的 `Observer`，直到最上面的 `Observable`；

然后又从最上面的 `Observable` 开始，对传入的 `Observer` 调用 `onSubscribe` 、`onNext` 等，最后调用到我们传入的 `Observer`；

在整个过程中，最重要的便是 `subscribeActual` 方法，和传入 `source::subscribe` 的 `Observer` 子类。

<!--more-->

### 示例

我们拿一个简单的例子来分析一下其中几个操作符的源码实现。

```kotlin
    fun testRxJava2() {
        Observable
            .create<String> { e: ObservableEmitter<String> ->
                e.onNext("test")
                e.onComplete()
            }
            .map { "test from map" }
            .flatMap { Observable.just("test from flatMap") }
            .subscribeOn(Schedulers.io())
            .observeOn(Schedulers.io())
            .subscribe(object : Observer<String> {
                override fun onComplete() {
                    println("onComplete() called")
                }

                override fun onSubscribe(d: Disposable) {
                    println("onSubscribe() called")
                }

                override fun onNext(t: String) {
                    println("onNext() called with: t = $t")
                }

                override fun onError(e: Throwable) {
                    println("onError() called with: e = $e")
                }
            })
    }
```

输出结果:

```shell
onSubscribe() called
onNext() called with: t = test from flatMap
onComplete() called
```

接下来，我们跟着调用链一个一个看。

### Before subscribe

#### create

```java
public abstract class Observable<T> implements ObservableSource<T> {
  
    public static <T> Observable<T> create(ObservableOnSubscribe<T> source) {
        ObjectHelper.requireNonNull(source, "source is null");
        return RxJavaPlugins.onAssembly(new ObservableCreate<T>(source));
    }
  
}
```

##### ObservableCreate

```java
public final class ObservableCreate<T> extends Observable<T> {
    final ObservableOnSubscribe<T> source;

    public ObservableCreate(ObservableOnSubscribe<T> source) {
        this.source = source;
    }
}  
```

`create` 方法需要我们传入一个 `ObservableOnSubscribe` 对象，将传入的对象保存到 `ObservableCreate` 的 `source` 变量中，最后返回该 `ObservableCreate` 对象。

#### map

```java
    public final <R> Observable<R> map(Function<? super T, ? extends R> mapper) {
        ObjectHelper.requireNonNull(mapper, "mapper is null");
        return RxJavaPlugins.onAssembly(new ObservableMap<T, R>(this, mapper));
    }
```

##### ObservableMap

```java
public final class ObservableMap<T, U> extends AbstractObservableWithUpstream<T, U> {
    final Function<? super T, ? extends U> function;

    public ObservableMap(ObservableSource<T> source, Function<? super T, ? extends U> function) {
        super(source);
        this.function = function;
    }
}

abstract class AbstractObservableWithUpstream<T, U> extends Observable<U> implements HasUpstreamObservableSource<T> {
    protected final ObservableSource<T> source;
  
    AbstractObservableWithUpstream(ObservableSource<T> source) {
        this.source = source;
    }
  
    @Override
    public final ObservableSource<T> source() {
        return source;
    }
}
```

`map` 方法新建一个 `ObservableMap` 对象，将调用该方法的当前 `Observable` 保存到 `ObservableMap` 的 成员变量 `source` 中，并将传入的转换 `Function` 保存到 成员变量 `function` 中；最后返回该 `ObservableMap` 对象。

下面几个操作符都是类似操作，就不重复叙述了。

#### flatMap

```java
public final <R> Observable<R> flatMap(Function<? super T, ? extends ObservableSource<? extends R>> mapper) {
    return flatMap(mapper, false);
}

    public final <R> Observable<R> flatMap(Function<? super T, ? extends ObservableSource<? extends R>> mapper, boolean delayErrors) {
        return flatMap(mapper, delayErrors, Integer.MAX_VALUE);
    }

    public final <R> Observable<R> flatMap(Function<? super T, ? extends ObservableSource<? extends R>> mapper, boolean delayErrors, int maxConcurrency) {
        return flatMap(mapper, delayErrors, maxConcurrency, bufferSize());
    }

    public final <R> Observable<R> flatMap(Function<? super T, ? extends ObservableSource<? extends R>> mapper,
            boolean delayErrors, int maxConcurrency, int bufferSize) {
        ObjectHelper.requireNonNull(mapper, "mapper is null");
        ObjectHelper.verifyPositive(maxConcurrency, "maxConcurrency");
        ObjectHelper.verifyPositive(bufferSize, "bufferSize");
        if (this instanceof ScalarCallable) {
            @SuppressWarnings("unchecked")
            T v = ((ScalarCallable<T>)this).call();
            if (v == null) {
                return empty();
            }
            return ObservableScalarXMap.scalarXMap(v, mapper);
        }
        return RxJavaPlugins.onAssembly(new ObservableFlatMap<T, R>(this, mapper, delayErrors, maxConcurrency, bufferSize));
    }
```

##### ObservableFlatMap

```java
public final class ObservableFlatMap<T, U> extends AbstractObservableWithUpstream<T, U> {
    final Function<? super T, ? extends ObservableSource<? extends U>> mapper;
    final boolean delayErrors;
    final int maxConcurrency;
    final int bufferSize;

    public ObservableFlatMap(ObservableSource<T> source,
            Function<? super T, ? extends ObservableSource<? extends U>> mapper,
            boolean delayErrors, int maxConcurrency, int bufferSize) {
        super(source);
        this.mapper = mapper;
        this.delayErrors = delayErrors;
        this.maxConcurrency = maxConcurrency;
        this.bufferSize = bufferSize;
    }
}
```

#### subscribeOn

```java
    public final Observable<T> subscribeOn(Scheduler scheduler) {
        ObjectHelper.requireNonNull(scheduler, "scheduler is null");
        return RxJavaPlugins.onAssembly(new ObservableSubscribeOn<T>(this, scheduler));
    }
```

##### ObservableSubscribeOn

```java
public final class ObservableSubscribeOn<T> extends AbstractObservableWithUpstream<T, T> {
    final Scheduler scheduler;

    public ObservableSubscribeOn(ObservableSource<T> source, Scheduler scheduler) {
        super(source);
        this.scheduler = scheduler;
    }
}
```

#### observeOn

```java
    public final Observable<T> observeOn(Scheduler scheduler) {
        return observeOn(scheduler, false, bufferSize());
    }

    public final Observable<T> observeOn(Scheduler scheduler, boolean delayError, int bufferSize) {
        ObjectHelper.requireNonNull(scheduler, "scheduler is null");
        ObjectHelper.verifyPositive(bufferSize, "bufferSize");
        return RxJavaPlugins.onAssembly(new ObservableObserveOn<T>(this, scheduler, delayError, bufferSize));
    }
```

##### ObservableObserveOn

```java
public final class ObservableObserveOn<T> extends AbstractObservableWithUpstream<T, T> {
    final Scheduler scheduler;
    final boolean delayError;
    final int bufferSize;
    public ObservableObserveOn(ObservableSource<T> source, Scheduler scheduler, boolean delayError, int bufferSize) {
        super(source);
        this.scheduler = scheduler;
        this.delayError = delayError;
        this.bufferSize = bufferSize;
    }
}
```

可以看到，从上到下，每次调用操作符静态方法，就是 `Observable`子类的不断转换。

### subscribe

```java
    public final void subscribe(Observer<? super T> observer) {
        ObjectHelper.requireNonNull(observer, "observer is null");
        try {
            observer = RxJavaPlugins.onSubscribe(this, observer);

            ObjectHelper.requireNonNull(observer, "The RxJavaPlugins.onSubscribe hook returned a null Observer. Please change the handler provided to RxJavaPlugins.setOnObservableSubscribe for invalid null returns. Further reading: https://github.com/ReactiveX/RxJava/wiki/Plugins");

            subscribeActual(observer);
        } catch (NullPointerException e) { // NOPMD
            throw e;
        } catch (Throwable e) {
            Exceptions.throwIfFatal(e);
            // can't call onError because no way to know if a Disposable has been set or not
            // can't call onSubscribe because the call might have set a Subscription already
            RxJavaPlugins.onError(e);

            NullPointerException npe = new NullPointerException("Actually not, but can't throw other exceptions due to RS");
            npe.initCause(e);
            throw npe;
        }
    }

    protected abstract void subscribeActual(Observer<? super T> observer);
```

可以看到，`subscribe` 方法内调用了抽象方法 `subscribeActual`;

经过上面的转换，最后调用 `subscribe` 方法的实际对象为 `ObservableObserveOn` 类对象，所以接着就到了 `ObservableObserveOn::subscribeActual` 方法。

#### ObservableObserveOn

```java
public final class ObservableObserveOn<T> extends AbstractObservableWithUpstream<T, T> {
  
      protected void subscribeActual(Observer<? super T> observer) {
        if (scheduler instanceof TrampolineScheduler) {
            source.subscribe(observer);
        } else {
            Scheduler.Worker w = scheduler.createWorker();
            source.subscribe(new ObserveOnObserver<T>(observer, w, delayError, bufferSize));
        }
    }
  
}
```

调用 `source.subscribe` 方法，传入 `ObserveOnObserver` 对象；上面说了，这里的 `source` 其实就是 `ObservableSubscribeOn` 对象；而调用 `subscribe`，最后依然会调用到 `subscribeActual` 方法，所以接着看 `ObservableSubscribeOn::subscribe` 方法。

#### ObservableSubscribeOn

```java
public final class ObservableSubscribeOn<T> extends AbstractObservableWithUpstream<T, T> {
  
    public void subscribeActual(final Observer<? super T> observer) {
        final SubscribeOnObserver<T> parent = new SubscribeOnObserver<T>(observer);

        observer.onSubscribe(parent);

        // scheduler.scheduleDirect 的实现这边先不展开，可以认为就是在指定线程执行任务
        parent.setDisposable(scheduler.scheduleDirect(new SubscribeTask(parent)));
    }
  
    final class SubscribeTask implements Runnable {
        private final SubscribeOnObserver<T> parent;

        SubscribeTask(SubscribeOnObserver<T> parent) {
            this.parent = parent;
        }

        @Override
        public void run() {
            source.subscribe(parent);
        }
    }  
  
}
```

通过 `scheduler.scheduleDirect` 方法切换线程，在指定的线程中执行 `SubscribeTask::run` 方法；最后也还是执行 `source.subscribe`，传入 `SubscribeOnObserver` 对象；这里的 `source` 就是 `ObservableFlatMap` 对象，所以接着看 `ObservableFlatMap::subscribeActual` 方法。

> 关于 `subscribeOn` 调用多次，只有最开始的那次会生效。其实准确地说，应该是每次都会切换线程，只是除了第一次以外，其他切换我们都是无感的。从这里我们就可以看到，切换线程后会执行 `source.subscribe`，其实就是执行上一个 `Observable` 的 `subscribeActual` 方法；而我们使用 `map`、`flatMap` 等操作符传入的转换操作，都不是这个阶段执行的，而是调用到顶层 `Observable` 之后，再通过 `Observer` 调用下来时才执行。

#### ObservableFlatMap

```java
public final class ObservableFlatMap<T, U> extends AbstractObservableWithUpstream<T, U> {
  
      @Override
    public void subscribeActual(Observer<? super U> t) {

        if (ObservableScalarXMap.tryScalarXMapSubscribe(source, t, mapper)) {
            return;
        }

        source.subscribe(new MergeObserver<T, U>(t, mapper, delayErrors, maxConcurrency, bufferSize));
    }
  
}
```

依然简单地调用 `source.subscribe` 方法，传入 `MergeObserver` 对象；这里的 `source` 是 `ObservableMap`，接着看 `ObservableMap::subscribeActual` 方法。

#### ObservableMap

```java
public final class ObservableMap<T, U> extends AbstractObservableWithUpstream<T, U> {
  
    public void subscribeActual(Observer<? super U> t) {
        source.subscribe(new MapObserver<T, U>(t, function));
    }
  
}
```

依然简单地调用 `source.subscribe` 方法，传入 `MapObserver` 对象；这里的 `source` 是 `ObservableCreate`，接着看 `ObservableCreate::subscribeActual` 方法。

#### ObservableCreate

```java
public final class ObservableCreate<T> extends Observable<T> {

    @Override
    protected void subscribeActual(Observer<? super T> observer) {
        CreateEmitter<T> parent = new CreateEmitter<T>(observer);
        observer.onSubscribe(parent);

        try {
            source.subscribe(parent);
        } catch (Throwable ex) {
            Exceptions.throwIfFatal(ex);
            parent.onError(ex);
        }
    }  
  
}
```

`ObservableCreate` 就是本例中的第一个 `Observable`，`source` 就是我们传入的 `ObservableOnSubscribe` 对象；在这里，先调用了 `observer.onSubscribe`，这个 `observer` 就是传入的 `MapObserver` 对象；然后依然调用了 `source.subscribe` 方法，这个 `source` 就是 我们传入的 `ObservableOnSubscribe`; 在例子中，我们调用了传入的 `CreateEmitter` 的 `onNext` 和 `onComplete` 方法。

从上到下，是 `Observable` 子类的不断转换；调用 `subscribe` 后，又变成从下到上的一个 `subscribe` 方法的调用过程。

### onSubscribe

在 `ObservableCreate` 的 `subscribeActual` 方法中，会调用 `observer.onSubscribe(parent)`；其中 `observer` 是 `ObservableMap` 中传入的 `MapObserver` ，而 `MapObserver` 继承于 `BasicFuseableObserver` 且没有重写 `onSubscribe` 方法。

##### ObservableMap

```java
public final class ObservableMap<T, U> extends AbstractObservableWithUpstream<T, U> {
 
    static final class MapObserver<T, U> extends BasicFuseableObserver<T, U> {
      
    }
  
}  

public abstract class BasicFuseableObserver<T, R> implements Observer<T>, QueueDisposable<R> {
 
    public final void onSubscribe(Disposable d) {
        // 校验 this.upstream 是 null，d 不是 null
        if (DisposableHelper.validate(this.upstream, d)) {
            // 注意，这里赋值
            this.upstream = d;
            if (d instanceof QueueDisposable) {
                this.qd = (QueueDisposable<T>)d;
            }

            if (beforeDownstream()) {
                // 调用下游 observer 的 onSubscribe 方法，在本例就是 ObservableFlatMap::MergeObserver
                downstream.onSubscribe(this);

                afterDownstream();
            }

        }
    }
  
}  
```

##### ObservableFlatMap

```java
public final class ObservableFlatMap<T, U> extends AbstractObservableWithUpstream<T, U> {
  
    static final class MergeObserver<T, U> extends AtomicInteger implements Disposable, Observer<T> {
      
        @Override
        public void onSubscribe(Disposable d) {
            if (DisposableHelper.validate(this.upstream, d)) {
                this.upstream = d;
                // 继续调用下游的 observer，在本例中就是 ObservableSubscribeOn::SubscribeOnObserver
                downstream.onSubscribe(this);
            }
        }      
      
    }
  
}  
```

##### ObservableSubscribeOn

```java
public final class ObservableSubscribeOn<T> extends AbstractObservableWithUpstream<T, T> {
  
    static final class SubscribeOnObserver<T> extends AtomicReference<Disposable> implements Observer<T>, Disposable {
      
        @Override
        public void onSubscribe(Disposable d) {
            // 这个方法就是将 d 保存到 this.upstream 中
            DisposableHelper.setOnce(this.upstream, d);
        }      
      
    }
  
}

public enum DisposableHelper implements Disposable {

    public static boolean setOnce(AtomicReference<Disposable> field, Disposable d) {
        ObjectHelper.requireNonNull(d, "d is null");
        if (!field.compareAndSet(null, d)) {
            d.dispose();
            if (field.get() != DISPOSED) {
                reportDisposableSet();
            }
            return false;
        }
        return true;
    }  
  
}
```

在这里，我们会发现，`ObservableSubscribeOn::SubscribeOnObserver::onSubscribe` 并没有按我们想的那样，继续调用下游的 `observer`。其实，我们留意一下 `ObservableSubscribeOn::subscribeActual` 方法：

```java
public final class ObservableSubscribeOn<T> extends AbstractObservableWithUpstream<T, T> {

    @Override
    public void subscribeActual(final Observer<? super T> observer) {
        final SubscribeOnObserver<T> parent = new SubscribeOnObserver<T>(observer);
        // 调用下游的 observer，在本例是 ObservableObserveOn::ObserveOnObserver
        observer.onSubscribe(parent);

        parent.setDisposable(scheduler.scheduleDirect(new SubscribeTask(parent)));
    }  
  
}
```

可以看到，在切换线程前，就调用了 `observer.onSubscribe` 方法。

也就是说，对 `subscribeOn` 方法而言，并不会切换 `observer` 的 `onSubscribe` 方法的执行线程；在哪个线程调用 `subscribe` ，`observer` 的 `onSubscribe` 就会在哪个线程调用。

继续分析，这里的 `observer` 就是 `ObservableObserveOn::ObserveOnObserver`。

##### ObservableObserveOn

```java
public final class ObservableObserveOn<T> extends AbstractObservableWithUpstream<T, T> {
  
    static final class ObserveOnObserver<T> extends BasicIntQueueDisposable<T>
    implements Observer<T>, Runnable {
      
        public void onSubscribe(Disposable d) {
            if (DisposableHelper.validate(this.upstream, d)) {
                this.upstream = d;
                if (d instanceof QueueDisposable) {
                    @SuppressWarnings("unchecked")
                    QueueDisposable<T> qd = (QueueDisposable<T>) d;

                    int m = qd.requestFusion(QueueDisposable.ANY | QueueDisposable.BOUNDARY);

                    if (m == QueueDisposable.SYNC) {
                        sourceMode = m;
                        queue = qd;
                        done = true;
                        downstream.onSubscribe(this);
                        schedule();
                        return;
                    }
                    if (m == QueueDisposable.ASYNC) {
                        sourceMode = m;
                        queue = qd;
                        downstream.onSubscribe(this);
                        return;
                    }
                }

                queue = new SpscLinkedArrayQueue<T>(bufferSize);

                downstream.onSubscribe(this);
            }
        }
      
    }
  
}
```

继续调用 `downstream.onSubscribe`，在本例中，`downstream` 就是我们传入的 `observer`，所以最后调用到了我们传入的 `observer` 的 `onSubscribe`。

### onNext

接着回到 `ObservableCreate::subscribeActual` ，在 `observer.onSubscribe` 调用结束后，会继续调用 `source.subscribe`，这个 `source` 是我们传入的 `ObservableOnSubscribe` 类，我们在示例中调用了 `emitter` 的 `onNext` 方法，这个 `emitter` 就是 `ObservableCreate::CreateEmitter`。

##### ObservableCreate

```java
public final class ObservableCreate<T> extends Observable<T> {
  
    static final class CreateEmitter<T>
    extends AtomicReference<Disposable>
    implements ObservableEmitter<T>, Disposable {
      
        @Override
        public void onNext(T t) {
            // 不能是 null
            if (t == null) {
                onError(new NullPointerException("onNext called with null. Null values are generally not allowed in 2.x operators and sources."));
                return;
            }
            // 没取消继续调用下游 observer.onNext 方法，在本例中就是 ObservableMap::MapObserver
            if (!isDisposed()) {
                observer.onNext(t);
            }
        }      
      
    }
  
}  
```

##### ObservableMap

```java
public final class ObservableMap<T, U> extends AbstractObservableWithUpstream<T, U> {
  
    static final class MapObserver<T, U> extends BasicFuseableObserver<T, U> {

        @Override
        public void onNext(T t) {
            if (done) {
                return;
            }

            if (sourceMode != NONE) {
                downstream.onNext(null);
                return;
            }

            U v;

            try {
                // 调用 mapper.apply 将上游发送的 t 转换成 v，这里的 mapper 就是我们传入的转换函数
                v = ObjectHelper.requireNonNull(mapper.apply(t), "The mapper function returned a null value.");
            } catch (Throwable ex) {
                fail(ex);
                return;
            }
            // 将转换得到的 v 继续向下游传递，downstream 在本例中就是 ObservableFlatMap::MergeObserver
            downstream.onNext(v);
        }      
      
    }
  
}  
```

##### ObservableFlatMap

```java
public final class ObservableFlatMap<T, U> extends AbstractObservableWithUpstream<T, U> {
 
    static final class MergeObserver<T, U> extends AtomicInteger implements Disposable, Observer<T> {
      
        @Override
        public void onNext(T t) {
            // safeguard against misbehaving sources
            if (done) {
                return;
            }
            ObservableSource<? extends U> p;
            try {
                // 调用 mapper.apply 将上游发来的 t 转换成新的 ObservableSource p
                // 在本例中，mapper 就是我们传入的转换函数
                p = ObjectHelper.requireNonNull(mapper.apply(t), "The mapper returned a null ObservableSource");
            } catch (Throwable e) {
                Exceptions.throwIfFatal(e);
                upstream.dispose();
                onError(e);
                return;
            }

            if (maxConcurrency != Integer.MAX_VALUE) {
                synchronized (this) {
                    if (wip == maxConcurrency) {
                        sources.offer(p);
                        return;
                    }
                    wip++;
                }
            }

            // 订阅新的 ObservableSource
            subscribeInner(p);
        }      
      
        void subscribeInner(ObservableSource<? extends U> p) {
            for (;;) {
                if (p instanceof Callable) {
                    if (tryEmitScalar(((Callable<? extends U>)p)) && maxConcurrency != Integer.MAX_VALUE) {
                        boolean empty = false;
                        synchronized (this) {
                            p = sources.poll();
                            if (p == null) {
                                wip--;
                                empty = true;
                            }
                        }
                        if (empty) {
                            drain();
                            break;
                        }
                    } else {
                        break;
                    }
                } else {
                    InnerObserver<T, U> inner = new InnerObserver<T, U>(this, uniqueId++);
                    if (addInner(inner)) {
                        // subscribe 转换后的 ObservableSource, observer 为 InnerObserver 类对象
                        // 跟上面的分析类似，p.subscribe 最后又会走到 inner::onSubscribe 和 inner::onNext 方法，然后在 InnerObserver::onNext 中，又会调用到 MergeObserver::drain 方法
                        p.subscribe(inner);
                    }
                    break;
                }
            }
        }   
      
        void drain() {
            if (getAndIncrement() == 0) {
                // 在这个方法里，会调用 downstream.onNext 方法；这里的 downstream 就是 ObservableSubscribeOn::SubscribeOnObserver
                // 这个方法有点长，这里就不放了
                drainLoop();
            }
        }      
      
    }
  
}  
```

##### ObservableSubscribeOn

```java
public final class ObservableSubscribeOn<T> extends AbstractObservableWithUpstream<T, T> {
 
    static final class SubscribeOnObserver<T> extends AtomicReference<Disposable> implements Observer<T>, Disposable {
     
        @Override
        public void onNext(T t) {
            // 这里的下游 downstream 在本例中就是 ObservableObserveOn::ObserveOnObserver
            downstream.onNext(t);
        }      
      
    }
  
}
```

##### ObservableObserveOn

```java
public final class ObservableObserveOn<T> extends AbstractObservableWithUpstream<T, T> {
 
    static final class ObserveOnObserver<T> extends BasicIntQueueDisposable<T>
    implements Observer<T>, Runnable {
     
        @Override
        public void onNext(T t) {
            if (done) {
                return;
            }

            if (sourceMode != QueueDisposable.ASYNC) {
                // 塞入队列
                queue.offer(t);
            }
            schedule();
        }

        void schedule() {
            if (getAndIncrement() == 0) {
                // 在指定的线程执行
                worker.schedule(this);
            }
        } 
      
        @Override
        public void run() {
            if (outputFused) {
                drainFused();
            } else {
                // 本例走这个方法，会将数据从队列中取出，然后调用 downstream.onNext，downstream 在本例中就是我们传入的 observer 了
                // 这个方法也不展开了              
                drainNormal();
            }
        }      
      
    }
  
}
```

最后，就调用到了我们传入的 `observer` 的 `onNext` 方法了。

`onComplete` 也是类似的。

### 总结

总的来说，整个流程分成三部分：

1. 从上到下：转换成对应的 `Observable`，最后调用 `subscribe`。
2. 从下到上：执行 `source.subscribe`，一直到第一个 `Observable`； `subscribeOn` 就是在这个过程中切换调用链线程。
3. 从上到下：包括 `onSubscribe`，`onNext` 等，执行 `downstream` 的方法，一直到我们传入的 `observer` ；`map`、`flatmap`、`observeOn` 等就是在这个过程中进行操作。

