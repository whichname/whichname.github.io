---
title: conan 实战之 cpp-httplib
tags: ["conan", "cpp-httplib"]
key: conan-cpp-httplib
---

## 前言

最近在搭建 c++ 的基础库，使用了 conan 来进行管理；其中团队几个项目同时使用了 cpp-httplib 库，另外一个项目由于设备限制，只能通过系统提供的代理方式来进行网络请求，所以还是手搓的网络请求；现在目标是修改 cpp-httplib 以支持被限制的设备，同时使用 conan 管理 cpp-httplib。

<!--more-->

### 什么是 conan

conan 是 c++ 的包管理器，类似于 android 的 maven、node 的 npm、python 的 pip。

借用官网的一张图：

![conan-install_flow](/assets/images/conan-cpp-httplib/conan-install_flow.png)

本地指定依赖某个库时，conan 会根据我们本地指定的 settings、options等： 

1. 先从本地缓存中找对应的构建配置文件
2. 如果本地没找到，就去指定的远程仓库找；如果在远程仓库找到了，就会下载构建配置文件到本地缓存中
3. 根据构建配置文件，从本地缓存中找有没有对应的二进制文件
4. 如果本地没有，就去远程仓库找；如果在远程仓库找到了，就会下载二进制文件到本地缓存中
5. 最后，会为我们指定的 generators 去生成对应的用于构建的文件。

详情请查看 [官方文档](https://docs.conan.io/en/latest/getting_started.html#installing-dependencies)

### 什么是 cpp-httplib

cpp-httplib 是一个 header-only 的跨平台 HTTP/HTTPS 库，具体可查看 [GitHub](https://github.com/yhirose/cpp-httplib) .

## 环境

示例环境为:

```
macOS 11.3.1
Conan version 1.36.0
Apple clang version 12.0.5 (clang-1205.0.22.9)
cmake version 3.20.1
```

## cpp-httplib

第一步，先修改 cpp-httplib 以支持被限制的设备。

这一步比较简单，根据设备开发文档，只有两个地方需要修改：

- 只能使用特定的方式创建 socket
- 调用 connect 的时候，需要传入代理地址

由于涉及业务，这部分代码就单纯使用 `printf` 来代替；我们定义一个宏 `MODE_PROXY`，用于条件编译。

```c++
// httplib.h

// 1. 修改 2100 ~ 2123 行代码
#ifdef _WIN32
    auto sock =
        WSASocketW(rp->ai_family, rp->ai_socktype, rp->ai_protocol, nullptr, 0,
                   WSA_FLAG_NO_HANDLE_INHERIT | WSA_FLAG_OVERLAPPED);
    if (sock == INVALID_SOCKET) {
      sock = socket(rp->ai_family, rp->ai_socktype, rp->ai_protocol);
    }
#elif defined MODE_PROXY
    printf("[cpp-httplib] socket by proxy\n");
    auto sock = socket(rp->ai_family, rp->ai_socktype, rp->ai_protocol);
#else
    auto sock = socket(rp->ai_family, rp->ai_socktype, rp->ai_protocol);
#endif

// 2. 修改 2247 ~ 2248 行代码
#ifdef  MODE_PROXY
    printf("[cpp-httplib] connect to proxy\n");
    auto ret =
        ::connect(sock, ai.ai_addr, static_cast<socklen_t>(ai.ai_addrlen));
#else
    auto ret =
        ::connect(sock, ai.ai_addr, static_cast<socklen_t>(ai.ai_addrlen));
#endif    
```

## conan

接下来，便是使用 conan 将修改后的 cpp-httplib 托管到远程仓库中。

### init

先 `cd` 进 cpp-httplib 目录，执行 `conan new httplib/0.8.8 -t` 。

`conan new` 命令会创建配置文件 `conanfile.py` ，`httplib/0.8.8` 指定模块名和版本，`-t` 指生成测试包 test_package.

来看看 `conanfile.py`:

```python
from conans import ConanFile, CMake, tools

class HttplibConan(ConanFile):
    # 模块信息
    name = "httplib"
    version = "0.8.8"
    license = "<Put the package license here>"
    author = "<Put your name here> <And your email here>"
    url = "<Package recipe repository url here, for issues about the package>"
    description = "<Description of Httplib here>"
    topics = ("<Put some tag here>", "<here>", "<and here>")
    # 模块配置
    settings = "os", "compiler", "build_type", "arch"
    options = {"shared": [True, False], "fPIC": [True, False]}
    default_options = {"shared": False, "fPIC": True}
    generators = "cmake"

    def config_options(self):
        if self.settings.os == "Windows":
            del self.options.fPIC
            
    # 如果你的源码和 conanfile.py 不在同一个路径，就用这个方法导出源码，我们不用
    def source(self):
        self.run("git clone https://github.com/conan-io/hello.git")
        # This small hack might be useful to guarantee proper /MT /MD linkage
        # in MSVC if the packaged project doesn't have variables to set it
        # properly
        tools.replace_in_file("hello/CMakeLists.txt", "PROJECT(HelloWorld)",
                              '''PROJECT(HelloWorld)
include(${CMAKE_BINARY_DIR}/conanbuildinfo.cmake)
conan_basic_setup()''')
    
    # 构建方法，我们可以在这里配置构建参数，比如给 cmake 传递变量
    def build(self):
        cmake = CMake(self)
        cmake.configure(source_folder="hello")
        cmake.build()

        # Explicit way:
        # self.run('cmake %s/hello %s'
        #          % (self.source_folder, cmake.command_line))
        # self.run("cmake --build . %s" % cmake.build_config)
        
    # 打包，在这个方法指定的文件，都会打包到包里，比如我们需要的头文件、编译后的静态/动态库
    def package(self):
        self.copy("*.h", dst="include", src="hello")
        self.copy("*hello.lib", dst="lib", keep_path=False)
        self.copy("*.dll", dst="bin", keep_path=False)
        self.copy("*.so", dst="lib", keep_path=False)
        self.copy("*.dylib", dst="lib", keep_path=False)
        self.copy("*.a", dst="lib", keep_path=False)

    # 这里可以使用 self.cpp_info 来配置使用本模块的项目，比如这里指定了使用本模块的项目要依赖 hello 这个库，这个 hello 其实是自动生成的，我们需要改成实际的库名 httplib
    def package_info(self):
        self.cpp_info.libs = ["hello"]
```

### 添加 options

上面说了，不同的 settings、options 都会构建不同的包；而我们这里需要两种模式，一种是正常的，一种是我们修改后的代理方式的，所以我们需要添加 options 来让使用方可以控制要构建哪种包。

```python
    options = {"shared": [True, False], "fPIC": [True, False], "mode": ["proxy", "default"]}
    default_options = {"shared": False, "fPIC": True, "mode": "default"}
```

我们这里增加了 `mode` 用来让使用方指定需要构建的是哪种类型，使用字符串是为了以后方便添加别的模式；同时在 `default_options` 中指定默认的模式。

#### settings vs options

settings 跟 options 有什么区别？

- settings 用来指定构建平台、编译器、编译类型等，这些是定义在  `~/.conan/settings.yml` 里的；
- options 是对包的配置，比如动态库还是静态库；一般我们需要定义自己的配置的时候，就在这里定义，比如我们这里定义的 `mode`;

### 导出源码

默认生成的 conanfile.py 文件中，有一个 `source` 方法，是用来指定源码的，而我们要用的是 `exports_sources` 属性。

```python
exports_sources = "httplib.h", "CMakeLists.txt", "httplibConfig.cmake.in"
// 同时删除 source 方法
```

#### source vs exports_sources

- `source` 方法是当 conanfile.py 和源码不在一起的时候用的，比如这里自动生成的 `source` 方法，指定的源码是 github 上的一个 hello 库；
- `exports_sources` 属性是当 conanfile.py 和源码在同一目录时使用的，这里我们构建 cpp-httplib 的时候，需要的是 `httplib.h`、`CMakeLists.txt`、`httplibConfig.cmake.in` 三个文件，所以指定为这三个文件；

### 修改 build 方法

默认生成的 `build` 方法指定了源码目录，而我们的源码导出后跟 conanfile.py 是同一目录，所以需要修改。

```python
    def build(self):
        cmake = CMake(self)
        cmake.configure()
        cmake.build()
```

### 修改 package 方法

`package` 方法用来配置需要打包的文件，其实这里不修改也可以，不过我们这里还是将不需要的部分删除，便于维护。

```python
    def package(self):
        self.copy("*.h", dst="include", src="")
```

### 修改 package_info 方法

`package_info` 方法一般用来设置 `self.cpp_info` ，使用方根据这个属性来获得使用我们这个库的一些要求，比如我们需要依赖哪些动态库、定义什么宏之类的。

我们可以在这里根据使用方指定的 `mode` 来要求他定义 `MODE_PROXY` 宏。

```python
    def package_info(self):
        if self.options.mode == "proxy":
            self.cpp_info.defines.append("MODE_PROXY")
```

### 添加 c++ 11 要求

cpp-httplib 是基于 c++ 11 的，因此我们需要校验使用方指定的 c++ 标准版本。为此，我们在 `configure` 方法中使用 `check_min_cppstd` 方法检查，如果使用方配置的版本低于我们指定的版本，就会报错。

```python
    def configure(self):
        tools.check_min_cppstd(self, "11")
```

至此，我们的打包配置文件就已经全部修改结束了，看一眼最后的 conanfile.py：

```python
from conans import ConanFile, CMake, tools

class HttplibConan(ConanFile):
    # 模块信息
    name = "httplib"
    version = "0.8.8"
    license = "MIT"
    url = "https://github.com/yhirose/cpp-httplib"
    description = "A C++11 single-file header-only cross platform HTTP/HTTPS library."
    topics = ("conan", "cpp-httplib", "http", "https", "header-only")
    # 模块配置
    settings = "os", "compiler", "build_type", "arch"
    options = {"shared": [True, False], "fPIC": [True, False], "mode": ["proxy", "default"]}
    default_options = {"shared": False, "fPIC": True, "mode": "default"}
    generators = "cmake"
    # 源文件
    exports_sources = "httplib.h", "CMakeLists.txt", "httplibConfig.cmake.in"

    def configure(self):
        tools.check_min_cppstd(self, "11")

    def config_options(self):
        if self.settings.os == "Windows":
            del self.options.fPIC
    
    # 构建方法，我们可以在这里配置构建参数，比如给 cmake 传递变量
    def build(self):
        cmake = CMake(self)
        cmake.configure()
        cmake.build()
        
    # 打包，在这个方法指定的文件，都会打包到包里，比如我们需要的头文件、编译后的静态/动态库
    def package(self):
        self.copy("*.h", dst="include", src="")

    # 这里可以使用 self.cpp_info 来配置使用本模块的项目，比如这里指定了使用本模块的项目要依赖 hello 这个库，这个 hello 其实是自动生成的，我们需要改成实际的库名 httplib
    def package_info(self):
        if self.options.mode == "proxy":
            self.cpp_info.defines.append("MODE_PROXY")
            
```

### 修改测试代码

最后，我们需要修改生成的 test_package/example.cpp 以进行测试：

```c++
#include <iostream>
#include "httplib.h"

int main() {
  #ifdef MODE_PROXY
    std::cout << "Mode is MODE_PROXY" << std::endl;
  #else
    std::cout << "Mode is MODE_DEFAULT" << std::endl;
  #endif	

  httplib::Client cli("http://cpp-httplib-server.yhirose.repl.co");
  if (auto res = cli.Get("/hi")) {
    std::cout << res->body << std::endl;
  } else {
    auto err = res.error();
    std::cout << err << std::endl;
  }

  return 0;
}
```

### 运行 default 模式

至此，我们的所有的配置就已经修改完成了，接下来运行 `conan create . demo/testing` 命令，就可以自动导出模块包，并运行我们的测试代码了，输出为：

```shell
Mode is MODE_DEFAULT
<a href="https://cpp-httplib-server.yhirose.repl.co/hi">Permanent Redirect</a>.
```

### 运行 proxy 模式

要运行 proxy 模式，我们有两种方式，一种是直接在命令行指定 options，一种是在命令行指定 profile 文件。

#### 命令行指定 options

我们直接给 `conan create` 加上 options : `conan create . demo/testing --options httplib:mode=proxy`， 也可以使用通配符 `*:mode=proxy`，运行输出为:

```shell
Mode is MODE_PROXY
[cpp-httplib] socket by proxy
[cpp-httplib] connect to proxy
<a href="https://cpp-httplib-server.yhirose.repl.co/hi">Permanent Redirect</a>.
```

#### 命令行指定 profile

profile 文件是一种配置文件，我们可以在其中指定 settings、options 等信息。conan 默认使用的是 ~/.conan/profiles/default 文件，我们可以通过 `--profiles ` 指定特定的 profile；比如这里，我们可以新建 ~/.conan/profiles/proxy 文件，并在其中指定 options：

```
[settings]
os=Macos
os_build=Macos
arch=x86_64
arch_build=x86_64
compiler=apple-clang
compiler.version=12.0
compiler.libcxx=libc++
compiler.cppstd=11
build_type=Release
[options]
# 这里也可以使用 *:mode=proxy:
httplib:mode=proxy
[build_requires]
[env]
```

然后运行我们的命令：`conan create . demo/testing --profile ~/.conan/profiles/proxy`，输出为：

```shell
Mode is MODE_PROXY
[cpp-httplib] socket by proxy
[cpp-httplib] connect to proxy
<a href="https://cpp-httplib-server.yhirose.repl.co/hi">Permanent Redirect</a>.
```

#### 关于 `conan create` 命令

`conan create . demo/testing` 命令其实是一组命令的组合：

```shell
conan export . demo/testing
conan install httplib/0.8.8@demo/testing --build=httplib
cd test_package
conan test . httplib/0.8.8@demo/testing
```

这个命令做了几件事：

1. `export` 将指定的源码导出到本地缓存中：~/.conan/data/httplib/0.8.8/demo/testing
2. `install`执行 conanfile.py 里的 configure 、build、package、package_info 方法，进行 c++ 标准版本的检查、构建、导出指定的文件，其实不止执行这几个方法，详情可以看官方文档
3. 运行 `test` 命令执行测试

其中 `.` 指的是模块目录，`demo/testing` 指定的是 user 和 channel，channel 一般有稳定版(stable)和测试版(testing)。

## 导出静态库

上面介绍了以单头文件形式导出模块的方式，想必有些同学已经发现了一个小问题，我们把模块要用的 `MODE_PROXY` 宏定义在了使用方；但这是单头文件形式导出不可避免的方式，因为头文件并不是编译单元，不会被编译，只有在第一次被 include 的时候，才能获取到当前预处理器的宏，也就是说我们只能获得使用方定义的宏。

那有没有其他方式可以将 `MODE_PROXY`定义在模块内，而不暴露出去呢？其实是有的，方案也很简单，将使用到这个宏的地方，写到 cpp 里；这样我们的模块导出的，就会变成静态库或者动态库，我们定义的宏就不会暴露到使用方。幸运的是，通过查看 cpp-httplib 的 CMakeLists.txt ，我们可以发现 cpp-httplib 本身就提供了这种方式。

cpp-httplib/CMakeLists.txt 158~190 行: 

```cmake
if(HTTPLIB_COMPILE)
	# Put the split script into the build dir
	configure_file(split.py "${CMAKE_CURRENT_BINARY_DIR}/split.py"
		COPYONLY
	)
	# Needs to be in the same dir as the python script
	configure_file(httplib.h "${CMAKE_CURRENT_BINARY_DIR}/httplib.h"
		COPYONLY
	)

	# Used outside of this if-else
	set(_INTERFACE_OR_PUBLIC PUBLIC)
	# Brings in the Python3_EXECUTABLE path we can use.
	find_package(Python3 REQUIRED)
	# Actually split the file
	# Keeps the output in the build dir to not pollute the main dir
	execute_process(COMMAND ${Python3_EXECUTABLE} "${CMAKE_CURRENT_BINARY_DIR}/split.py"
		WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
		ERROR_VARIABLE _httplib_split_error
	)
	if(_httplib_split_error)
		message(FATAL_ERROR "Failed when trying to split Cpp-httplib with the Python script.\n${_httplib_split_error}")
	endif()

	# split.py puts output in "out"
	set(_httplib_build_includedir "${CMAKE_CURRENT_BINARY_DIR}/out")
	# This will automatically be either static or shared based on the value of BUILD_SHARED_LIBS
	add_library(${PROJECT_NAME} "${_httplib_build_includedir}/httplib.cc")
	target_sources(${PROJECT_NAME}
		PUBLIC
			$<BUILD_INTERFACE:${_httplib_build_includedir}/httplib.h>
			$<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}/httplib.h>
	)
```

可以看到，如果 `HTTPLIB_COMPILE` 选项被打开，就会将 `split.py` 和 `httplib.h` 复制到 ${CMAKE_CURRENT_BINARY_DIR}/out 目录下，然后执行 `split.py`，最后将生成的 httplib.cc 编译成静态库；

我们来看一下 `split.py`：

```python
import os
import sys

border = '// ----------------------------------------------------------------------------'

PythonVersion = sys.version_info[0];

with open('httplib.h') as f:
    lines = f.readlines()
    inImplementation = False
    
    if PythonVersion < 3:
        os.makedirs('out')
    else:
        os.makedirs('out', exist_ok=True)
        
    with open('out/httplib.h', 'w') as fh:
        with open('out/httplib.cc', 'w') as fc:
            fc.write('#include "httplib.h"\n')
            fc.write('namespace httplib {\n')
            for line in lines:
                isBorderLine = border in line
                if isBorderLine:
                    inImplementation = not inImplementation
                else:
                    if inImplementation:
                        fc.write(line.replace('inline ', ''))
                        pass
                    else:
                        fh.write(line)
                        pass
            fc.write('} // namespace httplib\n')

```

代码比较简单，就是将分隔符中间的代码放入到 httplib.cc 中，其他部分依然保留在头文件中。刚好，我们上面加的代码，就在这两个分隔符中间，会被复制到 httplib.cc 中。

接下来，我们继续修改 conanfile.py，以支持静态库打包方式：

### 修改 exports_sources 属性

因为用到了 split.py，所以我们要把这个文件也加到源码文件列表中:

```python
exports_sources = "httplib.h", "CMakeLists.txt", "httplibConfig.cmake.in", "split.py"
```

### 修改 build 方法

在 build 方法中，打开 `HTTPLIB_COMPILE` 、根据 options 控制 cmake 是否要定义 `MODE_PROXY` 宏:

```python
    def build(self):
        cmake = CMake(self)
        cmake.definitions["HTTPLIB_COMPILE"] = "ON"
        if self.options.mode == "proxy":
            cmake.definitions["MODE_PROXY"] = "ON"
        cmake.configure()
        cmake.build()
```

### 修改 package 方法

有两个地方要修改，一个是我们要导出处理后的头文件，也就是 out 目录下的；第二个是我们需要将静态库也导出:

```python
    def package(self):
        self.copy("*.h", dst="include", src="out")
        self.copy("*.a", dst="lib", keep_path=False)
```

### 修改 package_info 方法

之前我们在这里要求使用方定义宏，现在使用方不需要再定义宏了；但是我们需要要求使用方依赖我们的静态库，同时依赖系统的 thread 和 zlib 动态库：

```python
    def package_info(self):
        self.cpp_info.libs = ["httplib"]
        self.cpp_info.system_libs = ["pthread", "z"]
```

> The `system_libs` are for libraries that do not belong to this package, and are installed in the system, like `pthread`.
> Any library that it is built as part of the package, should go to `libs`.
>
> [《difference between "cpp_info.libs" and "cpp_info.system_libs"》](https://github.com/conan-io/conan/issues/8104)

至此，我们的打包配置文件已经修改完成了，看一眼最后的 conanfile.py:

```python
from conans import ConanFile, CMake, tools


class HttplibConan(ConanFile):
    # 模块信息
    name = "httplib"
    version = "0.8.8"
    license = "MIT"
    url = "https://github.com/yhirose/cpp-httplib"
    description = "A C++11 single-file header-only cross platform HTTP/HTTPS library."
    topics = ("conan", "cpp-httplib", "http", "https", "header-only")
    # 模块配置
    settings = "os", "compiler", "build_type", "arch"
    options = {"shared": [True, False], "fPIC": [True, False], "mode": ["proxy", "default"]}
    default_options = {"shared": False, "fPIC": True, "mode": "default"}
    generators = "cmake"
    # 源文件
    exports_sources = "httplib.h", "CMakeLists.txt", "httplibConfig.cmake.in", "split.py"

    def configure(self):
        tools.check_min_cppstd(self, "11")

    def config_options(self):
        if self.settings.os == "Windows":
            del self.options.fPIC
    
    # 构建方法，我们可以在这里配置构建参数，比如给 cmake 传递变量
    def build(self):
        cmake = CMake(self)
        cmake.definitions["HTTPLIB_COMPILE"] = "ON"
        if self.options.mode == "proxy":
            cmake.definitions["MODE_PROXY"] = "ON"
        cmake.configure()
        cmake.build()
        
    # 打包，在这个方法指定的文件，都会打包到包里，比如我们需要的头文件、编译后的静态/动态库
    def package(self):
        self.copy("*.h", dst="include", src="out")
        self.copy("*.a", dst="lib", keep_path=False)

    # 这里可以使用 self.cpp_info 来配置使用本模块的项目，比如这里指定了使用本模块的项目要依赖 hello 这个库，这个 hello 其实是自动生成的，我们需要改成实际的库名 httplib
    def package_info(self):
        self.cpp_info.libs = ["httplib"]
        self.cpp_info.system_libs = ["pthread", "z"]

```

### 修改 CMakeLists.txt

在 build 方法指定的只是传入 cmake 的参数，我们需要在 CMakeLists.txt 处理，生成真正的宏，直接在 CMakeLists.txt 最后加入以下几行代码:

```cmake
option(MODE_PROXY "proxy mode" OFF)
if(MODE_PROXY)
	message(STATUS "[cpp-httplib] build with proxy mode")
	target_compile_definitions(${PROJECT_NAME} ${_INTERFACE_OR_PUBLIC} MODE_PROXY)
else()
	message(STATUS "[cpp-httplib] build with default mode")	
endif()	
```

> `option`:  If no initial `<value>` is provided, `OFF` is used. If `<variable>` is already set as a normal or cache variable, then the command does nothing.
>
>  [《cmake doc》](https://cmake.org/cmake/help/latest/command/option.html)

在这里定义的宏，只会在编译静态库的时候生效，也就不会暴露到使用方那边了。

### 运行 proxy 模式

我们再来运行一下 `conan create . demo/testing  --options httplib:mode=proxy`，输出如下：

```
Mode is MODE_DEFAULT
[cpp-httplib] socket by proxy
[cpp-httplib] connect to proxy
<a href="https://cpp-httplib-server.yhirose.repl.co/hi">Permanent Redirect</a>.
```

可以看到，我们定义的宏确实只在静态库内生效了。

## 其他

### 删除已打包的库

```shell
# 删除本地库
conan remove httplib
# 删除远程库, xxxx 是远程仓库在我们本地的名称
conan remove httplib -r xxxx
```

### 上传到远程仓库

```shell
# xxxx 是远程仓库在我们本地的名称
conan upload httplib -r xxxx
```

## 参考

- [C++包管理器——conan](http://blog.guorongfei.com/2018/04/23/conan-tutorial/)
- [从零开始的C++包管理器CONAN上手指南](http://chu-studio.com/posts/2019/%E4%BB%8E%E9%9B%B6%E5%BC%80%E5%A7%8B%E7%9A%84C++%E5%8C%85%E7%AE%A1%E7%90%86%E5%99%A8CONAN%E4%B8%8A%E6%89%8B%E6%8C%87%E5%8D%97)
- [conan doc](https://docs.conan.io/en/latest/)

