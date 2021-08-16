---
title: Java 线程池源码解析
tags: ["android-source"]
key: ThreadPoolExecutor
---

`ExecutorService::newFixedThreadPool()`、`ExecutorService::newSingleThreadExecutor()`、`ExecutorService::newCachedThreadPool()` 创建的都是 `ThreadPoolExecutor` 对象，`ExecutorService::newScheduledThreadPool()` 方法可以创建支持延时任务的线程池 `ScheduledThreadPoolExecutor`，这个类也是 `ThreadPoolExecutor` 的子类，所以直接从 `ThreadPoolExecutor` 类开始分析；

ps: 《阿里巴巴Java开发手册》中不建议使用 `ExecutorService` 来创建线程池。

<!--more-->

## ThreadPoolExecutor

### constructor

```java
/**
 * @param corePoolSize 核心线程数
 * @param maximumPoolSize 最大线程数
 * @param keepAliveTime 非核心线程最大空闲等待时间
 * @param unit keepAliveTime 时间单位
 * @param threadFactory 线程工厂，通过工厂创建线程
 * @param handler 拒绝策略
 */
public ThreadPoolExecutor(int corePoolSize,
                          int maximumPoolSize,
                          long keepAliveTime,
                          TimeUnit unit,
                          BlockingQueue<Runnable> workQueue,
                          ThreadFactory threadFactory,
                          RejectedExecutionHandler handler) {
    if (corePoolSize < 0 ||
        maximumPoolSize <= 0 ||
        maximumPoolSize < corePoolSize ||
        keepAliveTime < 0)
        throw new IllegalArgumentException();
    if (workQueue == null || threadFactory == null || handler == null)
        throw new NullPointerException();
    this.corePoolSize = corePoolSize;
    this.maximumPoolSize = maximumPoolSize;
    this.workQueue = workQueue;
    this.keepAliveTime = unit.toNanos(keepAliveTime);
    this.threadFactory = threadFactory;
    this.handler = handler;
}
```

### execute

```java
public void execute(Runnable command) {
    if (command == null)
        throw new NullPointerException();
    /*
     * Proceed in 3 steps:
     *
     * 1. If fewer than corePoolSize threads are running, try to
     * start a new thread with the given command as its first
     * task.  The call to addWorker atomically checks runState and
     * workerCount, and so prevents false alarms that would add
     * threads when it shouldn't, by returning false.
     *
     * 2. If a task can be successfully queued, then we still need
     * to double-check whether we should have added a thread
     * (because existing ones died since last checking) or that
     * the pool shut down since entry into this method. So we
     * recheck state and if necessary roll back the enqueuing if
     * stopped, or start a new thread if there are none.
     *
     * 3. If we cannot queue task, then we try to add a new
     * thread.  If it fails, we know we are shut down or saturated
     * and so reject the task.
     */
    int c = ctl.get();
    // 当前线程数没到核心线程数，创建线程
    if (workerCountOf(c) < corePoolSize) {
        // 创建核心线程，并将传入的 command 作为第一个任务，如果创建成功返回 true
        if (addWorker(command, true))
            return;
        // 创建失败，获取新的线程池状态
        c = ctl.get();
    }
    // 运行中，且入队列成功
    if (isRunning(c) && workQueue.offer(command)) {
        // 第二次获取线程池状态
        int recheck = ctl.get();
        // 如果不是运行中，且从队列中移除成功，拒绝该任务
        if (! isRunning(recheck) && remove(command))
            reject(command);
        // 运行中，或者从队列中移除失败，且当前没有线程，启动非核心线程（比如没有核心线程的线程池，需要启动非核心线程来执行队列中的任务）
        else if (workerCountOf(recheck) == 0)
            addWorker(null, false);
    }
    // 不是运行中，或者入队失败，且创建非核心线程执行任务失败，拒绝
    else if (!addWorker(command, false))
        reject(command);
}
```

1. 线程数 < 核心线程数，创建线程执行任务
2. 如果线程数达到了核心线程数，入队列；这时候要判断有没有线程在运行，没有的话要启动线程来执行队列中的任务
3. 如果入队列失败，比如队列满了，启动非核心线程执行任务
4. 启动非核心线程失败，比如达到了最大线程数，则拒绝

#### addWorker

```java
private static final int CAPACITY   = (1 << COUNT_BITS) - 1;

private static final int RUNNING    = -1 << COUNT_BITS;
private static final int SHUTDOWN   =  0 << COUNT_BITS;
private static final int STOP       =  1 << COUNT_BITS;
private static final int TIDYING    =  2 << COUNT_BITS;
private static final int TERMINATED =  3 << COUNT_BITS;

private boolean addWorker(Runnable firstTask, boolean core) {
    retry:
    for (;;) {
        int c = ctl.get();
        int rs = runStateOf(c);

        // 转换：rs >= SHUTDOWN && (rs != SHUTDOWN || firstTask != null || workQueue.isEmpty())
        // 1. 当前不为 RUNNING , 且 不为 SHUTDOWN
        // 2. 当前不为 RUNNING , 且 firstTask 不为 null
        // 3. 当前不为 RUNNING , 且 任务队列为空
        // 以上三种情况满足一种 就 返回 false
        if (rs >= SHUTDOWN &&
            ! (rs == SHUTDOWN &&
               firstTask == null &&
               ! workQueue.isEmpty()))
            return false;

        for (;;) {
            int wc = workerCountOf(c);
            // 总线程数达到最大 或者 核心线程数达到最大核心线程数 或者 核心+非核心线程数达到最大线程数
            if (wc >= CAPACITY ||
                wc >= (core ? corePoolSize : maximumPoolSize))
                return false;
            // 对线程数进行原子 +1，如果成功，跳出外层死循环
            if (compareAndIncrementWorkerCount(c))
                break retry;
            c = ctl.get();  // Re-read ctl
            // 线程池状态变了，继续外面死循环
            if (runStateOf(c) != rs)
                continue retry;
            // CAS 操作线程数失败，继续内层循环
            // else CAS failed due to workerCount change; retry inner loop
        }
    }

    boolean workerStarted = false;
    boolean workerAdded = false;
    Worker w = null;
    try {
        // 创建新线程
        w = new Worker(firstTask);
        final Thread t = w.thread;
        if (t != null) {
            final ReentrantLock mainLock = this.mainLock;
            mainLock.lock();
            try {
                // Recheck while holding lock.
                // Back out on ThreadFactory failure or if
                // shut down before lock acquired.
                int rs = runStateOf(ctl.get());
                if (rs < SHUTDOWN ||
                    (rs == SHUTDOWN && firstTask == null)) {
                    if (t.isAlive()) // precheck that t is startable
                        throw new IllegalThreadStateException();
                    // 添加进队列
                    workers.add(w);
                    int s = workers.size();
                    if (s > largestPoolSize)
                        largestPoolSize = s;
                    // 标记任务添加成功
                    workerAdded = true;
                }
            } finally {
                mainLock.unlock();
            }
            if (workerAdded) {
                // 启动线程
                t.start();
                workerStarted = true;
            }
        }
    } finally {
        if (! workerStarted)
            addWorkerFailed(w);
    }
    return workerStarted;
}
```

#### Woker

```java
    private final class Worker
        extends AbstractQueuedSynchronizer
        implements Runnable
    {
        final Thread thread;
        Runnable firstTask;
     
        Worker(Runnable firstTask) {
            setState(-1); // inhibit interrupts until runWorker
            this.firstTask = firstTask;
            // 创建线程，启动线程的时候，会调用本类的 run 方法
            this.thread = getThreadFactory().newThread(this);
        }

        public void run() {
            runWorker(this);
        }
      
    }

```

#### runWorker

```java
    final void runWorker(Worker w) {
        Thread wt = Thread.currentThread();
        // 取启动任务
        Runnable task = w.firstTask;
        w.firstTask = null;
        w.unlock(); // allow interrupts
        boolean completedAbruptly = true;
        try {
            // getTask 方法会阻塞获取下一个任务，如果返回 null，退出 while 循环，线程终止
            while (task != null || (task = getTask()) != null) {
                w.lock();
                // If pool is stopping, ensure thread is interrupted;
                // if not, ensure thread is not interrupted.  This
                // requires a recheck in second case to deal with
                // shutdownNow race while clearing interrupt
                // 1. 如果当前状态为 STOP 或者 TIDYING 或者 TERMINATED，且当前线程没有中断，中断线程
                // 2. 如果当前状态为 RUNNING 或者 SHUTDOWN，中断线程，再检查一次线程池状态，如果当前状态为 STOP 或者 TIDYING 或者 TERMINATED ，且当前线程没有被中断，中断线程
                if ((runStateAtLeast(ctl.get(), STOP) ||
                     (Thread.interrupted() &&
                      runStateAtLeast(ctl.get(), STOP))) &&
                    !wt.isInterrupted())
                    wt.interrupt();
                try {
                    beforeExecute(wt, task);
                    Throwable thrown = null;
                    try {
                        // 执行任务
                        task.run();
                    } catch (RuntimeException x) {
                        thrown = x; throw x;
                    } catch (Error x) {
                        thrown = x; throw x;
                    } catch (Throwable x) {
                        thrown = x; throw new Error(x);
                    } finally {
                        afterExecute(task, thrown);
                    }
                } finally {
                    task = null;
                    w.completedTasks++;
                    w.unlock();
                }
            }
            completedAbruptly = false;
        } finally {
            processWorkerExit(w, completedAbruptly);
        }
    }
```

#### getTask

```java
// 返回 null 将退出线程
private Runnable getTask() {
    boolean timedOut = false; // Did the last poll() time out?

    for (;;) {
        int c = ctl.get();
        int rs = runStateOf(c);

        // Check if queue empty only if necessary.
        // 1. 当前状态不为 RUNNING，且 工作队列为空
        // 2. 当前状态为 STOP 或者 TIDYING 或者 TERMINATED
        // workerCount 减一，返回 null 退出线程
        if (rs >= SHUTDOWN && (rs >= STOP || workQueue.isEmpty())) {
            decrementWorkerCount();
            return null;
        }

        int wc = workerCountOf(c);

        // Are workers subject to culling?
        // 如果运行核心线程超时退出，或者当前为非核心线程，那么需要设置超时
        boolean timed = allowCoreThreadTimeOut || wc > corePoolSize;

      	// 当前线程数大于最大线程数或者超时了
        // 而且当前线程不是最后一个存活的线程，或者任务队列为空了，不然没有线程处理任务队列中的任务了
        // workerCount 减一，返回 null 退出线程
        if ((wc > maximumPoolSize || (timed && timedOut))
            && (wc > 1 || workQueue.isEmpty())) {
            if (compareAndDecrementWorkerCount(c))
                return null;
            continue;
        }

        try {
            // 调用 poll 或者 take 来获取任务
            Runnable r = timed ?
                workQueue.poll(keepAliveTime, TimeUnit.NANOSECONDS) :
                workQueue.take();
            // 取到了任务，返回
            if (r != null)
                return r;
            // 没取到任务，标记 timedOut，下次循环如果允许超时，就退出；
            // 如果没有设置 allowCoreThreadTimeOut 且下次循环发现是核心线程，虽然这里标记了，也不会退出
            timedOut = true;
        } catch (InterruptedException retry) {
            timedOut = false;
        }
    }
}
```

#### 总结

可以看到，其实核心线程与非核心线程并没有什么区别，线程池要做的只是保证线程里的线程数的正确性就行了；并不是说最先开始的就是核心线程，超过核心线程数再启动的就是非核心线程，没有这种区分。

整个流程也比较简单：判断任务归属；需要启动线程的话创建 Worker，Worker 里面含有线程，启动线程执行 Worker 本身；Worker 里面再优先执行传入的任务，然后不断处理任务队列；处理完了，如果需要退出，就退出。

非核心线程处理完 firstTask 后，如果任务队列不为空，不会马上退出，而是会处理任务队列，直到任务队列为空了，才会被超时回收。

### submit

```java
    public <T> Future<T> submit(Callable<T> task) {
        if (task == null) throw new NullPointerException();
        // 将任务包多一层而已，变成 FutureTask，然后依旧调用 execute 方法，最后会执行 FutureTask::run 方法
        RunnableFuture<T> ftask = newTaskFor(task);
        execute(ftask);
        return ftask;
    }

    protected <T> RunnableFuture<T> newTaskFor(Callable<T> callable) {
        return new FutureTask<T>(callable);
    }
```

#### FutureTask

```java
public class FutureTask<V> implements RunnableFuture<V> {
 
    public void run() {
        // 检查状态
        if (state != NEW ||
            !U.compareAndSwapObject(this, RUNNER, null, Thread.currentThread()))
            return;
        try {
            Callable<V> c = callable;
            if (c != null && state == NEW) {
                V result;
                boolean ran;
                try {
                    // 运行构造传入的任务
                    result = c.call();
                    ran = true;
                } catch (Throwable ex) {
                    result = null;
                    ran = false;
                    setException(ex);
                }
                // 运行成功，更新状态，唤醒被阻塞的线程
                if (ran)
                    set(result);
            }
        } finally {
            // runner must be non-null until state is settled to
            // prevent concurrent calls to run()
            runner = null;
            // state must be re-read after nulling runner to prevent
            // leaked interrupts
            int s = state;
            if (s >= INTERRUPTING)
                handlePossibleCancellationInterrupt(s);
        }
    }
  
    protected void set(V v) {
        if (U.compareAndSwapInt(this, STATE, NEW, COMPLETING)) {
            outcome = v;
            // 更新状态
            U.putOrderedInt(this, STATE, NORMAL); // final state
            // 唤醒被阻塞的线程
            finishCompletion();
        }
    }  
  
    private void finishCompletion() {
        // assert state > COMPLETING;
        for (WaitNode q; (q = waiters) != null;) {
            // 更新 waiters, 不成功继续循环尝试，成功退出循环
            if (U.compareAndSwapObject(this, WAITERS, q, null)) {
                // 遍历链表
                for (;;) {
                    Thread t = q.thread;
                    if (t != null) {
                        q.thread = null;
                        // 唤醒线程
                        LockSupport.unpark(t);
                    }
                    WaitNode next = q.next;
                    if (next == null)
                        break;
                    q.next = null; // unlink to help gc
                    q = next;
                }
                break;
            }
        }

        done();

        callable = null;        // to reduce footprint
    }  
  
}
```

调用 `submit` 方法时，将任务包装成 `FutureTask` 再传入 `execute`，当任务执行完成，会唤醒通过 `Future::get()` 方法阻塞的线程，接下来看 `Future::get()` 方法：

```java
public class FutureTask<V> implements RunnableFuture<V> {

    public V get() throws InterruptedException, ExecutionException {
        int s = state;
        // 如果未完成，调用 awaitDone 方法
        if (s <= COMPLETING)
            s = awaitDone(false, 0L);
        return report(s);
    }
  
    private int awaitDone(boolean timed, long nanos)
        throws InterruptedException {
        // The code below is very delicate, to achieve these goals:
        // - call nanoTime exactly once for each call to park
        // - if nanos <= 0L, return promptly without allocation or nanoTime
        // - if nanos == Long.MIN_VALUE, don't underflow
        // - if nanos == Long.MAX_VALUE, and nanoTime is non-monotonic
        //   and we suffer a spurious wakeup, we will do no worse than
        //   to park-spin for a while
        long startTime = 0L;    // Special value 0L means not yet parked
        WaitNode q = null;
        boolean queued = false;
        for (;;) {
            int s = state;
            // 第四次循环，线程被唤醒了，返回当前状态
            if (s > COMPLETING) {
                if (q != null)
                    q.thread = null;
                return s;
            }
            else if (s == COMPLETING)
                // We may have already promised (via isDone) that we are done
                // so never return empty-handed or throw InterruptedException
                Thread.yield();
            else if (Thread.interrupted()) {
                removeWaiter(q);
                throw new InterruptedException();
            }
            // 第一次循环，如果任务未完成，创建 WaitNode 节点
            else if (q == null) {
                if (timed && nanos <= 0L)
                    return s;
                q = new WaitNode();
            }
            // 第二次循环，任务还是没完成，将 q 加入 waiters 链表（头插法）
            else if (!queued)
                queued = U.compareAndSwapObject(this, WAITERS,
                                                q.next = waiters, q);
            else if (timed) {
                final long parkNanos;
                if (startTime == 0L) { // first time
                    startTime = System.nanoTime();
                    if (startTime == 0L)
                        startTime = 1L;
                    parkNanos = nanos;
                } else {
                    long elapsed = System.nanoTime() - startTime;
                    if (elapsed >= nanos) {
                        removeWaiter(q);
                        return state;
                    }
                    parkNanos = nanos - elapsed;
                }
                // nanoTime may be slow; recheck before parking
                if (state < COMPLETING)
                    LockSupport.parkNanos(this, parkNanos);
            }
            // 第三次循环，任务还是没完成，阻塞线程，等待唤醒
            else
                LockSupport.park(this);
        }
    }
  
    // 返回任务执行结果
    private V report(int s) throws ExecutionException {
        Object x = outcome;
        if (s == NORMAL)
            return (V)x;
        if (s >= CANCELLED)
            throw new CancellationException();
        throw new ExecutionException((Throwable)x);
    }
  
}
```

## ScheduledThreadPoolExecutor

`ScheduledThreadPoolExecutor` 支持执行延时任务，是 `ThreadPoolExecutor` 的子类。

### constructor

```java
    public ScheduledThreadPoolExecutor(int corePoolSize) {
        super(corePoolSize, Integer.MAX_VALUE,
              DEFAULT_KEEPALIVE_MILLIS, MILLISECONDS,
              new DelayedWorkQueue());
    }

    public ScheduledThreadPoolExecutor(int corePoolSize,
                                       ThreadFactory threadFactory) {
        super(corePoolSize, Integer.MAX_VALUE,
              DEFAULT_KEEPALIVE_MILLIS, MILLISECONDS,
              new DelayedWorkQueue(), threadFactory);
    }

    public ScheduledThreadPoolExecutor(int corePoolSize,
                                       RejectedExecutionHandler handler) {
        super(corePoolSize, Integer.MAX_VALUE,
              DEFAULT_KEEPALIVE_MILLIS, MILLISECONDS,
              new DelayedWorkQueue(), handler);
    }

    public ScheduledThreadPoolExecutor(int corePoolSize,
                                       ThreadFactory threadFactory,
                                       RejectedExecutionHandler handler) {
        super(corePoolSize, Integer.MAX_VALUE,
              DEFAULT_KEEPALIVE_MILLIS, MILLISECONDS,
              new DelayedWorkQueue(), threadFactory, handler);
    }
```

构造方法传入的队列都是 `DelayedWorkQueue` ，后面再分析。

### execute & schedule

```java
    public void execute(Runnable command) {
        schedule(command, 0, NANOSECONDS);
    }

    public ScheduledFuture<?> schedule(Runnable command,
                                       long delay,
                                       TimeUnit unit) {
        if (command == null || unit == null)
            throw new NullPointerException();
        // decorateTask 方法就是返回第二个参数，也就是 ScheduledFutureTask
        RunnableScheduledFuture<Void> t = decorateTask(command,
            new ScheduledFutureTask<Void>(command, null,
                                          triggerTime(delay, unit),
                                          sequencer.getAndIncrement()));
        delayedExecute(t);
        return t;
    }

    protected <V> RunnableScheduledFuture<V> decorateTask(
        Runnable runnable, RunnableScheduledFuture<V> task) {
        return task;
    }
```

### deplayedExecute

```java
    private void delayedExecute(RunnableScheduledFuture<?> task) {
        // 线程池已经关闭，拒绝任务      
        if (isShutdown())
            reject(task);
        else {
            // 将任务队列添加进队列
            super.getQueue().add(task);
            if (isShutdown() &&
                !canRunInCurrentRunState(task.isPeriodic()) &&
                remove(task))
                task.cancel(false);
            else
                // 父类方法，创建线程
                ensurePrestart();
        }
    }
```

上面我们看到，这边的任务队列都是 `DelayedWorkQueue` 

### DelayedWorkQueue::add

```java
    static class DelayedWorkQueue extends AbstractQueue<Runnable>
        implements BlockingQueue<Runnable> {
      
        public boolean add(Runnable e) {
            return offer(e);
        }

        public boolean offer(Runnable x) {
            if (x == null)
                throw new NullPointerException();
            RunnableScheduledFuture<?> e = (RunnableScheduledFuture<?>)x;
            final ReentrantLock lock = this.lock;
            lock.lock();
            try {
                int i = size;
                // 扩容
                if (i >= queue.length)
                    grow();
                size = i + 1;
                // 空队列，直接插入
                if (i == 0) {
                    queue[0] = e;
                    setIndex(e, 0);
                } else {
                    // 插入，i 是未插入时的 size
                    siftUp(i, e);
                }
                // 如果插入到了队列头，说明这个任务需要最先被执行，唤醒一个阻塞的线程
                if (queue[0] == e) {
                    leader = null;
                    available.signal();
                }
            } finally {
                lock.unlock();
            }
            return true;
        }      
      
        // 看这个方法可以发现，其实延时队列内部是堆的实现方式，这个方法就是插入并调整堆，堆顶是需要最先执行的任务
        private void siftUp(int k, RunnableScheduledFuture<?> key) {
            while (k > 0) {
                // 二叉树父节点
                int parent = (k - 1) >>> 1;
                RunnableScheduledFuture<?> e = queue[parent];
                // 比较延时时间，如果 key 比 e 延时时间长，说明调整结束，退出循环
                if (key.compareTo(e) >= 0)
                    break;
                // 将父节点向下调整，继续循环
                queue[k] = e;
                setIndex(e, k);
                k = parent;
            }
            // 插入节点
            queue[k] = key;
            setIndex(key, k);
        }      
      
    }
```

所有传入的任务都会加到队列中，再由线程去取。

### ThreadPoolExecutor::ensurePrestart

```java
    void ensurePrestart() {
        int wc = workerCountOf(ctl.get());
        // 创建核心线程
        if (wc < corePoolSize)
            addWorker(null, true);
        // 核心线程数被设置为 0，且当前没有线程，创建非核心线程
        else if (wc == 0)
            addWorker(null, false);
    }
```

接下来又到 `addWorker` 方法了，创建 `Worker` 启动线程，由于这边传入的 `firstTask` 都是 `null`，线程会直接从队列中取任务；看来延时的关键就在于任务队列了，上面的构造函数我们可以看到，队列都是 `DelayedWorkQueue`；直接看 `DelayedWorkQueue::poll` 和 `DelayedWorkQueue::take` 方法。

### DelayedWorkQueue::poll

```java
        public RunnableScheduledFuture<?> poll(long timeout, TimeUnit unit)
            throws InterruptedException {
            long nanos = unit.toNanos(timeout);
            final ReentrantLock lock = this.lock;
            lock.lockInterruptibly();
            try {
                for (;;) {
                    RunnableScheduledFuture<?> first = queue[0];
                    if (first == null) {
                        // 不等待，返回 null；否则阻塞线程
                        if (nanos <= 0L)
                            return null;
                        else
                            nanos = available.awaitNanos(nanos);
                    } else {
                        long delay = first.getDelay(NANOSECONDS);
                        if (delay <= 0L)
                            return finishPoll(first); // 返回任务
                        if (nanos <= 0L)
                            return null; // 任务还没到执行时间，且不需要阻塞线程，返回 null
                        first = null; // don't retain ref while waiting
                        if (nanos < delay || leader != null)
                            // poll 操作运行的超时时间小于第一个任务的延时时间，阻塞线程传入的时间
                            nanos = available.awaitNanos(nanos);
                        else {
                            Thread thisThread = Thread.currentThread();
                            leader = thisThread;
                            try {
                                // 等待任务延时时间
                                long timeLeft = available.awaitNanos(delay);
                                // 等待结束后，更新 nanos，再跑一次循环，取到队列头符合就返回，防止队列头被移除等导致变化了
                                nanos -= delay - timeLeft;
                            } finally {
                                if (leader == thisThread)
                                    leader = null;
                            }
                        }
                    }
                }
            } finally {
                if (leader == null && queue[0] != null)
                    available.signal();
                lock.unlock();
            }
        }

        private RunnableScheduledFuture<?> finishPoll(RunnableScheduledFuture<?> f) {
            // 任务出列
            int s = --size;
            RunnableScheduledFuture<?> x = queue[s];
            queue[s] = null;
            // 调整堆，这里传入的 x 是最后一个节点
            if (s != 0)
                siftDown(0, x);
            setIndex(f, -1);
            return f;
        }

        private void siftDown(int k, RunnableScheduledFuture<?> key) {
            int half = size >>> 1;
            // 从根节点开始，找儿子节点中延时短的，且比 key 延时短的，往上移
            // 堆的删除就是将最后一个节点放到要删除的节点上，再调整
            // 这里就是把最后一个节点放根节点上，然后将根节点下移，直到满足堆
            while (k < half) {
                // 该节点的左子节点
                int child = (k << 1) + 1;
                RunnableScheduledFuture<?> c = queue[child];
                // 该节点的右子节点              
                int right = child + 1;
                // 左子节点比右子节点延时时间长，c 改为右子节点
                if (right < size && c.compareTo(queue[right]) > 0)
                    c = queue[child = right];
                // key 节点比子节点延时时间短，调整结束
                if (key.compareTo(c) <= 0)
                    break;
                // 向上调整节点，继续循环
                queue[k] = c;
                setIndex(c, k);
                k = child;
            }
            queue[k] = key;
            setIndex(key, k);
        }
```

### 总结

`ScheduledThreadPoolExecutor` 的所有任务，都会插入 `DelayedWorkQueue` 的堆中，堆顶是最先被执行的任务；然后启动线程，线程尝试获取队列中的任务，需要阻塞则调用 `Condition` 的阻塞方法来阻塞线程；到时间了就将任务出堆，执行。

ps: 堆的插入删除，时间复杂度是 `O(log(n))` ，空间复杂度是 `O(1)`

