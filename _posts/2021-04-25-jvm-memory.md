---
title: JVM 内存结构
tags: ["jvm"]
key: jvm-memory
---

## 前言

在讨论 JVM 内存结构前，我觉得有几点需要先明确一下：

- 我们说的 JVM 本质上就是一个进程，这个 JVM 进程执行 由我们编写的代码编译成的 字节码；也就是说，我们编写并运行了一个 Java 程序，其实是启动了一个 JVM 进程 用来解析运行我们的代码（解释执行）；所以我们讨论的内存结构，都是在进程的层面来讨论的，而不是系统层面；
- android 并不算 JVM，无论是 Dalvik 还是 ART ，因为他并不符合 Java 虚拟机规范，比如他并不能直接执行 Java 字节码；但是他很多地方跟 JVM 其实是一样的，所以这里讨论的内存结构也适用于 android；不过在栈帧里，安卓使用的是寄存器而不是操作数栈；
- 在规范中，并没有对 堆(Heap) 进行进一步的划分，年轻代老年代这些都是从 GC 的层面来进行划分的;

<!--more-->

## 内存结构

在 JVM 中，内存总共被划分为五块：堆、虚拟机栈、方法区、PC 寄存器、本地方法栈；其中，由所有线程共享的有两块：堆 和 方法区，另外三块每个线程各有自己的一份。

当然，除了这些之外，还有不属于 JVM 管理的 native 内存，但这里我们只讨论 JVM 管理的部分。

接下来，我们先来简单看一下每块区域的作用。

### 堆

就是存放对象实例的一块内存，程序中几乎所有的对象实例都在这里分配内存；

### 方法区

存放已加载的类型信息、常量、静态变量等，可以理解为，这里存放的就是类本身，而实例是保存在堆中；

### 虚拟机栈

虚拟机栈里面保存的是栈帧，每个栈帧对应一个方法，调用一个方法就是栈帧入栈，结束一个方法调用就是栈帧出栈；

栈帧里面保存有操作数栈、局部变量表、返回地址等；操作数栈是用于辅助字节码执行的，局部变量表是用于保存局部变量的，返回地址就是方法结束后要返回的指令地址；

### PC 寄存器

保存下一个要执行的字节码指令的行号，通过改变这个值来选取下一个要执行的指令；

### 本地方法栈

用来执行本地方法的；

## 从运行时角度理解内存结构

我们从一段具体的代码，来看看到底这几部分内存是什么作用。

```java
class Number {

	private int mVal;

	public Number(int val) {
		this.mVal = val;
	}

	public int add(int val) {
		int result = mVal + val;
		return result;
	}

}

class Test {
    
    public final static void main(String[] args) {
        Number num = new Number(1);
        int sum = num.add(2);
        System.out.println(sum);
    }

}
```

我们运行 `javap -v ClassName` 命令把这两个类先转成字节码再分析，因为 JVM 执行的是字节码。

在此，我们只着重分析 `Test::main()` 方法，因为其他部分原理也是相同的，分析 `Test::main()` 方法已经足够让我们理解这部分内容了。

`Test::main()` 方法的字节码如下：

```java
public static final void main(java.lang.String[]);
    descriptor: ([Ljava/lang/String;)V
    flags: ACC_PUBLIC, ACC_STATIC, ACC_FINAL
    Code:
      stack=3, locals=3, args_size=1
         0: new           #2                  // class Number
         3: dup
         4: iconst_1
         5: invokespecial #3                  // Method Number."<init>":(I)V
         8: astore_1
         9: aload_1
        10: iconst_2
        11: invokevirtual #4                  // Method Number.add:(I)I
        14: istore_2
        15: getstatic     #5                  // Field java/lang/System.out:Ljava/io/PrintStream;
        18: iload_2
        19: invokevirtual #6                  // Method java/io/PrintStream.println:(I)V
        22: return
      LineNumberTable:
        line 7: 0
        line 8: 9
        line 9: 15
        line 10: 22
```

我们可以看到，操作数栈(stack)、局部变量表(locals) 的大小在编译时就确定了，都是 3，接下来我们一行一行来分析。

1. ##### 首先，JVM 会创建一个栈帧放入当前线程的虚拟机栈内，栈帧内的 操作数栈 和 局部变量表 的大小都是 3；其中 局部变量表的第 0 位是入参，因为这里是静态方法，如果是非静态方法，那么第 0 位就是当前实例(this)，之后才是入参；

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-1.png)

2. ##### 从 PC 寄存器中取得当前需要执行的字节码的方法区内存地址或偏移量（以具体的虚拟机为准，我们这里假设为偏移量），也就是 0，然后执行对应的字节码 `new`;

   1. `new` 指令首先会将 `Number` 类加载进方法区，然后在堆中申请一块内存存放 `Number` 类的实例；
   2. 在堆中申请完内存后，会将内存地址，也就是引用，放入到操作数栈中；
   3. 执行完成后，将 PC 寄存器的值改为下一条要执行的指令的偏移量，也就是 3；

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-2.png)

3. ##### 从 PC 寄存器中获得偏移量，执行 `dup` 指令；`dup` 指令会将操作数栈中 `Number` 的实例引用复制一份再压入操作数栈中，此时，操作数栈中就有了两个实例引用；PC 寄存器改为 `4`;

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-3.png)

4. ##### 从 PC 寄存器中获得偏移量，执行 `iconst_1` 指令；`iconst_1` 指令将常数 1 压入操作数栈中，此时，操作数栈中栈顶就是常数 1，下面还有两个 `Number` 类实例的引用；PC 寄存器改为 5；

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-4.png)

5. ##### 执行 `invokespecial` 指令，调用`Number`类的构造函数；

   1. 操作数栈中栈顶常数 1 出栈，作为入参；
   2. 操作数栈中栈顶元素此时为 `Number` 类的实例引用，也出栈，作为被调用函数的类实例；
   3. 此时操作数栈中只剩一个`Number`类的实例引用；
   4. PC 寄存器内数据改为下一条指令也就是 8；

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-5.png)

6. ##### 执行 `astore_1` 指令，将操作数栈顶元素放到局部变量表第二个位置；PC 寄存器值改为 9;

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-6.png)

7. ##### 执行 `aload_1` 指令，将局部变量表第二个元素，放入操作数栈中；PC 寄存器值改为 10;

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-7.png)

8. ##### 执行 `iconst_2` 指令，将常数 2 压入操作数栈中；PC 寄存器值改为 11;

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-8.png)

9. ##### 执行 `invokevirtual` 指令，调用 `Number` 类的虚方法 `add`；

   1. 操作数栈中栈顶常数 2 出栈，作为入参；
   2. 操作数栈中栈顶元素此时为 `Number` 类的实例引用，也出栈，作为被调用函数的类实例；
   3. 执行方法，此时，会跟当前 `main` 方法一样，创建一个栈帧压入虚拟机栈，待方法结束后， `add` 方法对应的栈帧出栈，于是又回到了 `main` 方法；
   4. 将 `add` 方法的返回值压入操作数栈；
   5. PC 寄存器内的值改为 14；

   ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-9.png)

10. ##### 执行 `istore_2` 指令，将操作数栈顶的 `add` 方法的返回值 3 ，放入局部变量表的第三个位置；PC 寄存器值改为 15；

    ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-10.png)

11. ##### 执行 `getstatic` 指令，获得 `System.out` 对象压入操作数栈中；因为是静态变量，所以该指令不需要操作数栈顶为对应实例的地址，可以对比之前的 `Number` 类的构造方法和 `add` 方法的调用；PC 寄存器值改为 18；

    ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-11.png)

12. ##### 执行 `iload_2` 指令，将局部变量表的第三个元素压入操作数栈中；PC 寄存器值改为 19;

    ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-12.png)

13. ##### 执行 `invokevitual` 指令，调用 `System.out.println` 方法，传入栈顶元素 3；PC 寄存器值改为 22；

    ![jvm-mem]({{ site.url }}/assets/images/jvm-mem/mem-13.png)

14. ##### 执行 `retrun` 指令，当前栈帧出栈；但是堆中的 `Number` 实例需要等 GC 的时候才会被回收，虽然我们已经没有办法引用到他；同时，还需要将 PC 寄存器值改为返回地址，这样 JVM 才知道这个方法结束后，接下来应该执行哪条指令；这个返回地址，是在调用方法时传入的，就是调用方法时的 PC 寄存器的值；

## 最后

1. 实际的执行过程还有很多细节，比如栈内分配、操作数栈与下个栈帧的局部变量表共用优化等等；
2. android 也是差不多的，只是把操作数栈改成寄存器而已；





