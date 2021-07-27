---
title: Android Studio 一直卡在 sync ( Configure projects ) 的问题（ 由于 conan ）
tags: ["cmake"]
key: android-studio-config-forever-conan
---

在某一个分支正常编译的项目，切换到另一个分支，差别有点大，却一直卡在 sync 阶段，且没有日志输出，报错均为 intellij 内部错误。

<!--more-->

后面尝试在命令行执行 conan 命令，发现安装失败：

1. 通过脚本设置了交叉编译环境
2. 指定 build_require 需要 flatc，由于设置了交叉编译环境，导致编出来是 arm 的
3. gradle 脚本中，需要使用 flatc 生成 flatbuffer 数据结构，运行 flatc 的时候报错

最后通过手动替换为 Macos 平台下的 flatc 解决，替换后需要 refresh c++ project 一下。

最坑的地方在于没有报错信息出来....

