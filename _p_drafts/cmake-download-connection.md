---
title: cmake 下载文件 Couldn't connect to server
tags: ["cmake"]
key: cmake-download-connection
---

cmake 调用 file(DOWNLOAD) 时，不断报错：status code(7), status msg(Couldn't connect to server)。

<!--more-->

一开始以为是版本问题，换了几个版本也不行（其实想想 release 版本，这种低级错误出现的概率确实不大，换版本纯属病急乱投医），在 cmake 调用 execute_process 执行 ping 命令又成功。

其实 cmake 的 file(DOWNLOAD) api 内部执行的是 curl 命令，手动运行一下 curl 命令，发现也无法请求，怀疑是代理导致的；查看 `.zshrc` ，果然发现配置了全局代理，而我刚好换了一个代理端口，这里却没改过来。注释或者修改 `.zshrc` 里的代理，成功：

```shell
export http_proxy="http://127.0.0.1:1087"
export https_proxy="http://127.0.0.1:1087"
```

如果代理在 `.bashrc` 里也同理，改完记得 `source` 一下