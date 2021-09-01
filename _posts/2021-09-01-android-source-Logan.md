---
title: Logan 源码解析（下） - Native
tags: ["android-source"]
key: Logan-Native
---

本文对美团开源的日志 sdk `Logan` 进行源码分析，涉及 `Android ` 和 `Native` 两部分。

由于篇幅问题，会将这两部分拆成两篇文章，本篇为 `Native` 端的解析。

<!--more-->

项目地址：[https://github.com/Meituan-Dianping/Logan](https://github.com/Meituan-Dianping/Logan) 

## CLogan

### logan.mmap2 数据结构

`CLogan` 内部有一个缓存，写日志时，是先写到这个缓存中，再 `flush` 到日志文件中；该缓存优先使用 `mmap` 映射 `cache` 目录下的 `logan.mmap2` 文件得到的内存，如果 `mmap` 不可用，再使用内存缓存。

使用 `mmap` 可以减少日志的丢失，打开应用时，可以从 `logan.mmap2` 文件中获得 上次没来得及 `flush` 到日志文件的日志，将其写入到日志文件。

`logan.mmap2` 文件内的数据是按 `CLogan` 自定的结构来存储的，文件内的数据分为两部分：

- 开头记录了关于本次日志的 `logan` 版本和对应的日志文件，这部分内容是没压缩也没加密的；
- 然后是具体的日志数据，这部分是压缩加密后的数据；

如果需要深入理解 `CLogan` 的源码，需要对这结构有一定的了解；所以在源码分析前，先介绍一下这个文件的结构，注意这部分数据是紧密相连的，这里的换行只是为了方便阅读：

```
协议头(一个字节，'\15' 八进制，也就是十进制的 13) 
mmap 信息长度(两个字节，包含数据最后的 '\0') 
mmap 信息数据( {"logan_version": 3, "file": "xxxx" }\0 ) 
协议尾(一个字节，'\16' 八进制，也就是十进制的 14) 
  
接下来数据的总长度, (三个字节，低字节序，给 c 看的；因为后面还有一个协议头和日志长度，所以会比给 java 看的日志长度多 5 个字节)
协议头(一个字节，'\1' 八进制，也就是十进制的 1)
日志长度(四个字节，高字节序)(不包含协议尾的长度，代码注释有写，是为了兼容以前的版本)

# 以下内容是压缩加密后的数据
第一条日志
第二条日志
...
第 n 条日志
# 以上内容是压缩加密后的数据

协议尾(一个字节, '\0' 八进制，也就是十进制的 0)
```

其中，日志部分的协议头，在每次 `flush` 之后会重新添加；协议尾在结束压缩流的时候会添加；

接下来看个例子：写入三条 "test log" 日志后，使用 hexdump 查看二进制；由于当日志文件为空时，第一条日志会被 `flush` 到日志文件中，所以在 `logan.mmap2` 中只能看到两条日志内容；

这里为了阅读方便，**屏蔽了压缩和加密相关代码**:

```shell
 ~/CLogan hexdump -C build/logan_cache/logan.mmap2
          # 协议头
00000000  0d                                                |.               |
             # mmap 信息长度，十进制的 40
             28 00                                          | (.             |
                   # mmap 信息，长度 40
                   7b 22 6c 6f 67  61 6e 5f 76 65 72 73 69  |   {"logan_versi|
00000010  6f 6e 22 3a 33 2c 22 66  69 6c 65 22 3a 22 32 30  |on":3,"file":"20|
00000020  32 31 2d 30 38 2d 32 30  22 7d 00                 |21-08-20"}.     |
                                            # 协议尾
                                            0e              |           .    |
                                               # 数据长度，低字节序，比内容长度多 5，十进制的 135
                                               87 00 00     |            ... |
                                                        # 协议头
                                                        01  |               .|
          # 内容长度，高字节序，比数据长度少 5，十进制的 130                                                                                                      
00000030  00 00 00 82                                       |....            |
                      # 第一条日志，实际项目中是压缩加密后的数据
                      7b 22 63 22  3a 22 74 65 73 74 20 6c  |    {"c":"test l|
00000040  6f 67 22 2c 22 66 22 3a  32 2c 22 6c 22 3a 31 36  |og","f":2,"l":16|
00000050  33 30 34 31 37 30 35 34  2c 22 6e 22 3a 22 6d 61  |30417054,"n":"ma|
00000060  69 6e 22 2c 22 69 22 3a  31 2c 22 6d 22 3a 66 61  |in","i":1,"m":fa|
00000070  6c 73 65 7d 0a                                    |lse}.           |
                         # 第二条日志，实际项目中是压缩加密后的数据
                         7b 22 63  22 3a 22 74 65 73 74 20  |     {"c":"test |
00000080  6c 6f 67 22 2c 22 66 22  3a 32 2c 22 6c 22 3a 31  |log","f":2,"l":1|
00000090  36 33 30 34 31 37 30 35  34 2c 22 6e 22 3a 22 6d  |630417054,"n":"m|
000000a0  61 69 6e 22 2c 22 69 22  3a 31 2c 22 6d 22 3a 66  |ain","i":1,"m":f|
000000b0  61 6c 73 65 7d 0a                                 |alse}.          |
                            00 00  00 00 00 00 00 00 00 00  |      ..........|
000000c0  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|
*
00025800 
```

注意，这里的示例是去除了压缩、加密后的数据；实际上在写入时，会根据日志文件是否为空、是否达到 `flush` 的阈值等来决定是否写入日志；且数据会进行分块、多条日志可能会编入同一个压缩单元等；

### 初始化

#### clogan_init

clogan_core.c

```c
/**
 * Logan初始化
 * @param cachedirs 缓存路径
 * @param pathdirs  目录路径
 * @param max_file  日志文件最大值
 */
int
clogan_init(const char *cache_dirs, const char *path_dirs, int max_file, const char *encrypt_key16,
            const char *encrypt_iv16) {
    int back = CLOGAN_INIT_FAIL_HEADER;
    // 参数校验、只初始化一次
    if (is_init_ok ||
        NULL == cache_dirs || strnlen(cache_dirs, 11) == 0 ||
        NULL == path_dirs || strnlen(path_dirs, 11) == 0 ||
        NULL == encrypt_key16 || NULL == encrypt_iv16) {
        back = CLOGAN_INIT_FAIL_HEADER;
        return back;
    }
    ...
    // mmap 文件目录
    char *cache_path = malloc(total);
    if (NULL != cache_path) {
        _mmap_file_path = cache_path;
    }
    ...
  	// 创建保存 mmap 文件的目录，这里是传入的 cache_dirs 目录下的 logan_cache 目录
    makedir_clogan(cache_path); 
    // 再加上 mmap 文件名，就是完整路径，文件名是 logan.mmap2
    strcat(cache_path, LOGAN_CACHE_FILE);
    ...
    // 日志文件目录
    char *dirs = (char *) malloc(total); 
    if (NULL != dirs) {
        _dir_path = dirs; 
    }
    ...
    // 创建日志文件目录
    makedir_clogan(_dir_path); 
    
    int flag = LOGAN_MMAP_FAIL;
    // _logan_buffer 是 mmap 缓存，_cache_buffer_buffer 是内存 buffer
    // 所以两者都为空的时候，调用 open_mmap_file_clogan 方法
    // _logan_buffer 不为空的时候，说明是 MMAP 模式
    // _logan_buffer 为空，而 _cache_buffer_buffer 不为空时，说明是内存模式
    if (NULL == _logan_buffer) {
        if (NULL == _cache_buffer_buffer) {
            // 创建 MMAP 缓存,该方法下面分析
            flag = open_mmap_file_clogan(cache_path, &_logan_buffer, &_cache_buffer_buffer);
        } else {
            // 内存缓存模式
            flag = LOGAN_MMAP_MEMORY;
        }
    } else {
        // MMAP 模式
        flag = LOGAN_MMAP_MMAP;
    }
    ...
    if (is_init_ok) {
        // 申请 logan_model 内存
        if (NULL == logan_model) {
            logan_model = malloc(sizeof(cLogan_model));
            ...
        }
        if (flag == LOGAN_MMAP_MMAP) //MMAP的缓存模式,从缓存的MMAP中读取数据,该方法下面分析
            read_mmap_data_clogan(_dir_path);
    } else {
        // 初始化失败，删除所有路径
        if (NULL != _dir_path) {
            free(_dir_path);
            _dir_path = NULL;
        }
        if (NULL != _mmap_file_path) {
            free(_mmap_file_path);
            _mmap_file_path = NULL;
        }
    }
    return back;
}
```

接下来着重看下 `open_mmap_file_clogan` 和 `read_mmap_data_clogan` 两个方法。

#### open_mmap_file_clogan

mmap_util.c

接下来看 `open_mmap_file_clogan` 方法，该方法用来创建 `mmap` 缓存 `buffer` 或者内存 `buffer`

```c
//创建MMAP缓存buffer或者内存buffer
int open_mmap_file_clogan(char *_filepath, unsigned char **buffer, unsigned char **cache) {
    int back = LOGAN_MMAP_FAIL;
    if (NULL == _filepath || 0 == strnlen(_filepath, 128)) {
        back = LOGAN_MMAP_MEMORY;
    } else {
        unsigned char *p_map = NULL;
        // 150k
        int size = LOGAN_MMAP_LENGTH;
        // 打开文件, 后两个添加权限
        int fd = open(_filepath, O_RDWR | O_CREAT, S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP);
        //是否需要检查mmap缓存文件重新检查
        int isNeedCheck = 0; 
        if (fd != -1) { 
            int isFileOk = 0;
            //先判断文件是否有值，再mmap内存映射
            FILE *file = fopen(_filepath, "rb+"); 
            if (NULL != file) {
                // 获得文件内容长度
                fseek(file, 0, SEEK_END);
                long longBytes = ftell(file);
                // 长度不够 150k，写入 150k 的 0 
                if (longBytes < LOGAN_MMAP_LENGTH) {
                    fseek(file, 0, SEEK_SET);
                    char zero_data[size];
                    memset(zero_data, 0, size);
                    size_t _size = 0;
                    _size = fwrite(zero_data, sizeof(char), size, file);
                    fflush(file);
                    if (_size == size) {
                        printf_clogan("copy data 2 mmap file success\n");
                        isFileOk = 1;
                        isNeedCheck = 1;
                    } else {
                        isFileOk = 0;
                    }
                } else {
                    isFileOk = 1;
                }
                fclose(file);
            } else {
                isFileOk = 0;
            }
          
            // 加强保护，对映射的文件要有一个适合长度的文件
            // 只有文件长度不够 且 写入成功后，才需要
            // 重新获得文件长度，确保长度至少为 150k
            if (isNeedCheck) { 
                FILE *file = fopen(_filepath, "rb");
                if (file != NULL) {
                    fseek(file, 0, SEEK_END);
                    long longBytes = ftell(file);
                    if (longBytes >= LOGAN_MMAP_LENGTH) {
                        isFileOk = 1;
                    } else {
                        isFileOk = 0;
                    }
                    fclose(file);
                } else {
                    isFileOk = 0;
                }
            }

            // 文件合法，调用 mmap 进行映射
            if (isFileOk) {
                p_map = (unsigned char *) mmap(0, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
            }
            // 映射成功 LOGAN_MMAP_MMAP, 失败则尝试内存缓存 LOGAN_MMAP_MEMORY
            if (p_map != MAP_FAILED && NULL != p_map && isFileOk) {
                back = LOGAN_MMAP_MMAP;
            } else {
                back = LOGAN_MMAP_MEMORY;
                printf_clogan("open mmap fail , reason : %s \n", strerror(errno));
            }
            close(fd);

            //在返回mmap前,做最后一道判断，如果有mmap文件才用mmap
            if (back == LOGAN_MMAP_MMAP &&
                access(_filepath, F_OK) != -1) { 
                back = LOGAN_MMAP_MMAP;
                *buffer = p_map;
            } else {
                back = LOGAN_MMAP_MEMORY;
                // 映射失败了，且有内存地址，解除映射
                if (NULL != p_map)
                    munmap(p_map, size);
            }
        } else {
            printf_clogan("open(%s) fail: %s\n", _filepath, strerror(errno));
        }
    }

    // 无论 mmap 成功失败，都会申请一块内存缓存
    int size = LOGAN_MEMORY_LENGTH;
    unsigned char *tempData = malloc(size);
    if (NULL != tempData) {
        memset(tempData, 0, size);
        *cache = tempData;
        // 如果 mmap 失败，buffer 就是 cache, 也就是申请的堆上的内存缓存      
        if (back != LOGAN_MMAP_MMAP) {
            *buffer = tempData;
            back = LOGAN_MMAP_MEMORY; 
        }
    } else {
        if (back != LOGAN_MMAP_MMAP)
            back = LOGAN_MMAP_FAIL;
    }
    return back;
}
```

这个方法主要是对 mmap 文件进行校验、映射、失败的话使用内存缓存；

不管 mmap 成功与否，都会从堆上分配一块内存，作为 cache；当使用内存缓存的时候，buffer == cache ;

缓存大小为 150k。

> Logan 的 mmap 机制，并不是为了性能，而直接映射到日志文件；而是为了防止日志丢失，其实日志还是先写到  mmap 缓存或者 内存缓存中，再 flush 到日志文件中。

#### read_mmap_data_clogan

clogan_core.c

```c
void read_mmap_data_clogan(const char *path_dirs) {
    if (buffer_type == LOGAN_MMAP_MMAP) {
        unsigned char *temp = _logan_buffer;
        unsigned char *temp2 = NULL;
        char i = *temp;
        // 协议头开头
        if (LOGAN_MMAP_HEADER_PROTOCOL == i) {
            // 取长度，unsigned char 跟 char 都是一个字节，int 是四个，所以 len_array 长度是 4
            // 而实际上，只用到了前两个字节，但是由于要调整字节序，所以还是使用四个字节
            temp++;
            char len_array[] = {'\0', '\0', '\0', '\0'};
            // 第一个字节
            len_array[0] = *temp;
            temp++;
            // 第二个字节
            len_array[1] = *temp;
            // 调整字节序
            adjust_byteorder_clogan(len_array);
            // 转成 int 取长度
            int *len_p = (int *) len_array;
            temp++;
            temp2 = temp;
            // 获得长度
            int len = *len_p;

            printf_clogan("read_mmapdata_clogan > path's json length : %d\n", len);

            if (len > 0 && len < 1024) {
                // temp 往前移，获得协议尾；中间的就是 mmap 的信息（不是日志）
                temp += len;
                i = *temp;
                if (LOGAN_MMAP_TAIL_PROTOCOL == i) {
                    char dir_json[len];
                    memset(dir_json, 0, len);
                    memcpy(dir_json, temp2, len);
                    printf_clogan("dir_json %s\n", dir_json);
                    // 解析 json 数据，获得 mmap 信息
                    cJSON *cjson = cJSON_Parse(dir_json);

                    if (NULL != cjson) {
                        // 获得 mmap 信息内的 logan 版本
                        cJSON *dir_str = cJSON_GetObjectItem(cjson,
                                                             LOGAN_VERSION_KEY);
                        // 获得 mmap 信息内的日志文件路径
                        cJSON *path_str = cJSON_GetObjectItem(cjson, LOGAN_PATH_KEY);
                        if ((NULL != dir_str && cJSON_Number == dir_str->type &&
                             CLOGAN_VERSION_NUMBER == dir_str->valuedouble) &&
                            (NULL != path_str && path_str->type == cJSON_String &&
                             !is_string_empty_clogan(path_str->valuestring))) {

                            printf_clogan(
                                    "read_mmapdata_clogan > dir , path and version : %s || %s || %lf\n",
                                    path_dirs, path_str->valuestring, dir_str->valuedouble);

                            size_t dir_len = strlen(path_dirs);
                            size_t path_len = strlen(path_str->valuestring);
                            size_t length = dir_len + path_len + 1;
                            char file_path[length];
                            memset(file_path, 0, length);
                            memcpy(file_path, path_dirs, dir_len);
                            strcat(file_path, path_str->valuestring);
                            temp++;
                            // 写入 上次未写入日志文件 的日志
                            write_mmap_data_clogan(file_path, temp);
                        }
                        cJSON_Delete(cjson);
                    }
                }
            }
        }
    }
}
```

#### write_mmap_data_clogan

clogan_core.c

```c
// 写入到日志文件
void write_mmap_data_clogan(char *path, unsigned char *temp) {
    logan_model->total_point = temp;
    logan_model->file_path = path;
    // 取前面三个字节作为长度
    char len_array[] = {'\0', '\0', '\0', '\0'};
    len_array[0] = *temp;
    temp++;
    len_array[1] = *temp;
    temp++;
    len_array[2] = *temp;

    adjust_byteorder_clogan(len_array);//调整字节序,默认为低字节序,在读取的地方处理

    int *total_len = (int *) len_array;
    // 数据长度
    int t = *total_len;
    printf_clogan("write_mmapdata_clogan > buffer total length %d\n", t);
    if (t > LOGAN_WRITEPROTOCOL_HEAER_LENGTH && t < LOGAN_MMAP_LENGTH) {
        // 长度包含日志协议头和日志长度，也就是这部分也会被写入到日志文件
        logan_model->total_len = t;
        if (NULL != logan_model) {
            // 打开对应的日志文件
            if (init_file_clogan(logan_model)) {
                logan_model->is_ok = 1;
                logan_model->zlib_type = LOGAN_ZLIB_NONE;
                // 写入到日志文件中
                clogan_flush();
                // 关闭文件
                fclose(logan_model->file);
                logan_model->file_stream_type = LOGAN_FILE_CLOSE;
            }
        }
    } else {
        logan_model->file_stream_type = LOGAN_FILE_NONE;
    }
    logan_model->total_len = 0;
    logan_model->file_path = NULL;
}
```

#### clogan_flush

clogan_core.c

```c
// 写入到日志文件中
int clogan_flush(void) {
    int back = CLOGAN_FLUSH_FAIL_INIT;
    if (!is_init_ok || NULL == logan_model) {
        return back;
    }
    write_flush_clogan();
    back = CLOGAN_FLUSH_SUCCESS;
    printf_clogan(" clogan_flush > write flush\n");
    return back;
}
```

#### write_flush_clogan

clogan_core.c

```c
void write_flush_clogan() {
    // 该调用链不会走这里
    if (logan_model->zlib_type == LOGAN_ZLIB_ING) {
        clogan_zlib_end_compress(logan_model);
        update_length_clogan(logan_model);
    }
    if (logan_model->total_len > LOGAN_WRITEPROTOCOL_HEAER_LENGTH) {
        unsigned char *point = logan_model->total_point;
        // LOGAN_MMAP_TOTALLEN 是 3, total_point 指向长度字段位置，长度字段是 3 个字节，+3 就指向日志协议头了
        point += LOGAN_MMAP_TOTALLEN;
        write_dest_clogan(point, sizeof(char), logan_model->total_len, logan_model);
        printf_clogan("write_flush_clogan > logan total len : %d \n", logan_model->total_len);
        clear_clogan(logan_model);
    }
}
```

#### write_dest_clogan

clogan_core.c

```c
//文件写入磁盘、更新文件大小
void write_dest_clogan(void *point, size_t size, size_t length, cLogan_model *loganModel) {
    if (!is_file_exist_clogan(loganModel->file_path)) { //如果文件被删除,再创建一个文件
        if (logan_model->file_stream_type == LOGAN_FILE_OPEN) {
            fclose(logan_model->file);
            logan_model->file_stream_type = LOGAN_FILE_CLOSE;
        }
        if (NULL != _dir_path) {
            if (!is_file_exist_clogan(_dir_path)) {
                makedir_clogan(_dir_path);
            }
            init_file_clogan(logan_model);
            printf_clogan("clogan_write > create log file , restore open file stream \n");
        }
    }
    if (CLOGAN_EMPTY_FILE == loganModel->file_len) { //如果是空文件插入一行CLogan的头文件
        insert_header_file_clogan(loganModel);
    }
    fwrite(point, sizeof(char), logan_model->total_len, logan_model->file);//写入到文件中
    fflush(logan_model->file);
    loganModel->file_len += loganModel->total_len; //修改文件大小
}
```



### 打开日志文件

#### clogan_open

`clogan_open` 主要做几件事：

1. 校验状态和参数
2. 如果是重新开日志文件，将旧的日志写入
3. 打开日志文件、获得日志文件长度、初始化 `zlib`
4. 更新 `logan.mmap2` 内的 `mmap` 相关信息
5. 初始化加密

clogan_core.c

```c
int clogan_open(const char *pathname) {
    ...
    if (NULL != logan_model) { // 打开了新文件，旧日志需要回写
        // LOGAN_WRITEPROTOCOL_HEAER_LENGTH 是 5，协议头+长度
        if (logan_model->total_len > LOGAN_WRITEPROTOCOL_HEAER_LENGTH) {
            clogan_flush();
        }
        // 关闭旧文件
        if (logan_model->file_stream_type == LOGAN_FILE_OPEN) {
            fclose(logan_model->file);
            logan_model->file_stream_type = LOGAN_FILE_CLOSE;
        }
        if (NULL != logan_model->file_path) {
            free(logan_model->file_path);
            logan_model->file_path = NULL;
        }
        logan_model->total_len = 0;
    } else {
        // 第一次打开，申请内存并初始化
        logan_model = malloc(sizeof(cLogan_model));
        if (NULL != logan_model) {
            memset(logan_model, 0, sizeof(cLogan_model));
        } else {
            logan_model = NULL; //初始化Logan_model失败,直接退出
            is_open_ok = 0;
            back = CLOGAN_OPEN_FAIL_MALLOC;
            return back;
        }
    }
    ...
    char *temp_file = malloc(file_path_len); // 日志文件路径
    if (NULL != temp_file) {
        ...
        if (!init_file_clogan(logan_model)) {  //初始化文件IO和文件大小
            is_open_ok = 0;
            back = CLOGAN_OPEN_FAIL_IO;
            return back;
        }
        if (init_zlib_clogan(logan_model) != Z_OK) { //初始化zlib压缩
            is_open_ok = 0;
            back = CLOGAN_OPEN_FAIL_ZLIB;
            return back;
        }
        logan_model->buffer_point = _logan_buffer;
        // MMAP 模式，写入 logan 版本和日志文件路径到 logan.mmap2 中，也就是上面说的 mmap 信息
        if (buffer_type == LOGAN_MMAP_MMAP) {  
            cJSON *root = NULL;
            Json_map_logan *map = NULL;
            root = cJSON_CreateObject();
            map = create_json_map_logan();
            char *back_data = NULL;
            if (NULL != root) {
                // 构造 mmap 信息
                if (NULL != map) {
                    // logan 版本
                    add_item_number_clogan(map, LOGAN_VERSION_KEY, CLOGAN_VERSION_NUMBER);
                    // 日志文件路径
                    add_item_string_clogan(map, LOGAN_PATH_KEY, pathname);
                    inflate_json_by_map_clogan(root, map);
                    back_data = cJSON_PrintUnformatted(root);
                }
                cJSON_Delete(root);
                if (NULL != back_data) {
                    // 写入 mmap 信息，下面会介绍
                    add_mmap_header_clogan(back_data, logan_model);
                    free(back_data);
                } else {
                    logan_model->total_point = _logan_buffer;
                    logan_model->total_len = 0;
                }
            } else {
                logan_model->total_point = _logan_buffer;
                logan_model->total_len = 0;
            }
            // 此时的 total_point 指向日志数据长度，三个字节，所以 +3 跳过，指向日志内容部分
            logan_model->last_point = logan_model->total_point + LOGAN_MMAP_TOTALLEN;

            if (NULL != map) {
                delete_json_map_clogan(map);
            }            
        } else {
            // 内存模式，前面是日志数据长度，共三个字节
            logan_model->total_point = _logan_buffer;
            logan_model->total_len = 0;
            logan_model->last_point = logan_model->total_point + LOGAN_MMAP_TOTALLEN;
        }
        // 更新 logan_model 中的数据
        restore_last_position_clogan(logan_model);
        // 初始化加密
        init_encrypt_key_clogan(logan_model);
        logan_model->is_ok = 1;
        is_open_ok = 1;
    } else {
        is_open_ok = 0;
        back = CLOGAN_OPEN_FAIL_MALLOC;
        printf_clogan("clogan_open > malloc memory fail\n");
    }

    if (is_open_ok) {
        back = CLOGAN_OPEN_SUCCESS;
        printf_clogan("clogan_open > logan open success\n");
    } else {
        printf_clogan("clogan_open > logan open fail\n");
    }
    return back;
}
```

#### add_mmap_header_clogan

clogan_core.c

```c
/*
 * 对mmap添加header和确定总长度位置
 */
void add_mmap_header_clogan(char *content, cLogan_model *model) {
    // 字符串长度 + '\0'结束符
    size_t content_len = strlen(content) + 1;
    size_t total_len = content_len;
    char *temp = (char *) model->buffer_point;
    // 写入协议头，'\15'
    *temp = LOGAN_MMAP_HEADER_PROTOCOL;
    temp++;
    // 写入 mmap 信息长度，两个字节
    *temp = total_len;
    temp++;
    *temp = total_len >> 8;
    printf_clogan("\n add_mmap_header_clogan len %d\n", total_len);
    temp++;
    // 写入 mmap 信息
    memcpy(temp, content, content_len);
    temp += content_len;
    // 写入协议尾
    *temp = LOGAN_MMAP_TAIL_PROTOCOL;
    temp++;
    // 更新指针
    model->total_point = (unsigned char *) temp; // 总数据的total_length的指针位置
    model->total_len = 0;
}
```

这里结合上面的 [loganmmap2-数据结构](#loganmmap2-数据结构) 就很好理解了。

#### restore_last_position_clogan

clogan_core.c

```c
/**
 * 确立最后的长度指针位置和最后的写入指针位置
 */
void restore_last_position_clogan(cLogan_model *model) {
    // 这里指向的是 三个字节的日志数据长度字段 后面的日志内容开头
    unsigned char *temp = model->last_point;
    // 写入协议头，LOGAN_WRITE_PROTOCOL_HEADER 是 '\1'
    *temp = LOGAN_WRITE_PROTOCOL_HEADER;
    // 总长度 +1
    model->total_len++;
    temp++;
    // content_lent_point 指向四个字节的日志长度位置
    model->content_lent_point = temp; 
    // 写入日志长度，四个字节
    *temp = model->content_len >> 24;
    model->total_len++;
    temp++;
    *temp = model->content_len >> 16;
    model->total_len++;
    temp++;
    *temp = model->content_len >> 8;
    model->total_len++;
    temp++;
    *temp = model->content_len;
    model->total_len++;
    temp++;
    // 更新 last_point 指向实际的日志开始位置
    model->last_point = temp;

    printf_clogan("restore_last_position_clogan > content_len : %d\n", model->content_len);
}
```

这里结合上面的 [loganmmap2-数据结构](#loganmmap2-数据结构) 也很好理解。

### 写日志

#### clogan_write

clogan_core.c

```c
/**
 @brief 写入数据 按照顺序和类型传值(强调、强调、强调)
 @param flag 日志类型 (int)
 @param log 日志内容 (char*)
 @param local_time 日志发生的本地时间，形如1502100065601 (long long)
 @param thread_name 线程名称 (char*)
 @param thread_id 线程id (long long) 为了兼容JAVA
 @param ismain 是否为主线程，0为是主线程，1位非主线程 (int)
 */
int
clogan_write(int flag, char *log, long long local_time, char *thread_name, long long thread_id,
             int is_main) {
    ...
    // 判断MMAP文件是否存在,如果被删除,用内存缓存
    if (buffer_type == LOGAN_MMAP_MMAP && !is_file_exist_clogan(_mmap_file_path)) {
        if (NULL != _cache_buffer_buffer) {
            buffer_type = LOGAN_MMAP_MEMORY;
            buffer_length = LOGAN_MEMORY_LENGTH;
            printf_clogan("clogan_write > change to memory buffer");
            // 初始化变量
            _logan_buffer = _cache_buffer_buffer;
            logan_model->total_point = _logan_buffer;
            logan_model->total_len = 0;
            logan_model->content_len = 0;
            logan_model->remain_data_len = 0;
            if (logan_model->zlib_type == LOGAN_ZLIB_INIT) {
                clogan_zlib_delete_stream(logan_model); //关闭已开的流
            }
            logan_model->last_point = logan_model->total_point + LOGAN_MMAP_TOTALLEN;
            restore_last_position_clogan(logan_model);
            init_zlib_clogan(logan_model);
            init_encrypt_key_clogan(logan_model);
            logan_model->is_ok = 1;
        } else {
            buffer_type = LOGAN_MMAP_FAIL;
            is_init_ok = 0;
            is_open_ok = 0;
            _logan_buffer = NULL;
        }
    }
    // 构造日志 json 数据，下面会先看这个
    Construct_Data_cLogan *data = construct_json_data_clogan(log, flag, local_time, thread_name,
                                                             thread_id, is_main);
    if (NULL != data) {
        // 写日志
        clogan_write_section(data->data, data->data_len);
        construct_data_delete_clogan(data);
        back = CLOGAN_WRITE_SUCCESS;
    } else {
        back = CLOGAN_WRITE_FAIL_MALLOC;
    }
    return back;
}
```

#### construct_json_data_clogan

这个方法主要是包装日志，对照 [loganmmap2-数据结构](#loganmmap2-数据结构) 

construct_data.c

```c
static const char *log_key = "c";
static const char *flag_key = "f";
static const char *localtime_key = "l";
static const char *threadname_key = "n";
static const char *threadid_key = "i";
static const char *ismain_key = "m";

Construct_Data_cLogan *
construct_json_data_clogan(char *log, int flag, long long local_time, char *thread_name,
                           long long thread_id, int is_main) {
    ...
    // c 日志数据
    add_item_string_clogan(map, log_key, log);
    // f 日志类型
    add_item_number_clogan(map, flag_key, (double) flag);
    // l 时间
    add_item_number_clogan(map, localtime_key, (double) local_time);
    // n 线程名称
    add_item_string_clogan(map, threadname_key, thread_name);
    // i 线程 id
    add_item_number_clogan(map, threadid_key, (double) thread_id);
    // m 是否主线程
    add_item_bool_clogan(map, ismain_key, is_main);
    ...
    // 添加换行符，所以看上面的数据，会发现每条日志最后都是换行符
    char return_data[] = {'\n'};
    memcpy(temp_point, return_data, 1);
    ...
}
```

#### clogan_write_section

clogan_core.c

```c
//如果数据流非常大,切割数据,分片写入
void clogan_write_section(char *data, int length) {
    // LOGAN_WRITE_SECTION 是 20k
    int size = LOGAN_WRITE_SECTION;
    // 切片
    int times = length / size;
    // 切片后剩下的数据
    int remain_len = length % size;
    char *temp = data;
    int i = 0;
    // 写入切片数据, 如果日志没达到 20k，则不会走这个循环
    for (i = 0; i < times; i++) {
        clogan_write2(temp, size);
        temp += size;
    }
    // 写入剩余数据
    if (remain_len) {
        clogan_write2(temp, remain_len);
    }
}
```

#### clogan_write2

clogan_core.c

```c
void clogan_write2(char *data, int length) {
    if (NULL != logan_model && logan_model->is_ok) {
        // 压缩数据
        clogan_zlib_compress(logan_model, data, length);
        // 更新数据长度到缓存中，这个方法比较简单，就不分析了
        update_length_clogan(logan_model);
        int is_gzip_end = 0;
        // 如果文件为空，或者一个压缩单元结束
        // 这里 LOGAN_MAX_GZIP_UTIL 是 5k，也就是说如果当前是完整的片 20k 就肯定走这里
        if (!logan_model->file_len ||
            logan_model->content_len >= LOGAN_MAX_GZIP_UTIL) {
            // 结束压缩
            clogan_zlib_end_compress(logan_model);
            is_gzip_end = 1;
            // 更新长度到缓存
            update_length_clogan(logan_model);
        }

        int isWrite = 0;
        // 如果文件为空，写入
        if (!logan_model->file_len && is_gzip_end) { 
            isWrite = 1;
            printf_clogan("clogan_write2 > write type empty file \n");
        } 
        // 如果是内存模式，且压缩单元结束，写入
        else if (buffer_type == LOGAN_MMAP_MEMORY && is_gzip_end) { //直接写入文件
            isWrite = 1;
            printf_clogan("clogan_write2 > write type memory \n");
        } 
        // MMAP 模式，且文件长度已经超过三分之一，写入，记得 mmap 文件是多大么？150k
        else if (buffer_type == LOGAN_MMAP_MMAP &&
                   logan_model->total_len >=
                   buffer_length / LOGAN_WRITEPROTOCOL_DEVIDE_VALUE) {
            isWrite = 1;
            printf_clogan("clogan_write2 > write type MMAP \n");
        }
        if (isWrite) { 
            //写入
            write_flush_clogan();
        } else if (is_gzip_end) { 
            //如果是mmap类型,不回写IO,初始化下一步
            logan_model->content_len = 0;
            logan_model->remain_data_len = 0;
            init_zlib_clogan(logan_model);
            // 重新写入协议头、日志长度
            restore_last_position_clogan(logan_model);
            init_encrypt_key_clogan(logan_model);
        }
    }
}
```

在`clogan_write2` 方法中，此时的日志数据长度 小于等于切片大小 20k，有几种情况：

1. 日志文件为空，写入日志文件
2. 大于 5k，结束本次压缩，关闭压缩流；
3. 如果是内存缓存模式，写入日志文件
4. 如果是 mmap 模式，且当前缓存内数据大于文件长度的 三分之一，也就是 150k 的三分之一 50k，写入日志文件

对照着 [loganmmap2-数据结构](#loganmmap2-数据结构) 示例来看：

1. 假如现在是内存缓存模式，每条日志长度为 4k，那么：
   1. 第一条日志满足条件 1，写入到日志文件中
   2. 第二条日志长度 4k，不满足条件 2 和 3，所以不会写入到日志文件中，压缩流也不会关闭
   3. 第三条日志长度 4k，这时候总共有 8k 日志了，超过了 5k，满足条件 2 和 3，会结束压缩流，写入到日志文件中
2. 假如现在是 mmap 模式，每条日志长度为 30k，那么：
   1. 第一条日志满足条件 1，写入到日志文件中
   2. 第二条日志大于 5k，会结束本次压缩流，但不满足条件 4，所以不会写入到日志文件中
   3. 第三条日志大于 5k，同样会结束压缩流，写入后，总共有 60k 数据了，满足条件 4，所以会写入到日志文件中

接下来对这个方法内调用的函数，依个分析：

#### clogan_zlib_compress

zlib_util.c

```c
void clogan_zlib_compress(cLogan_model *model, char *data, int data_len) {
    if (model->zlib_type == LOGAN_ZLIB_ING ||
        model->zlib_type == LOGAN_ZLIB_INIT) {
        model->zlib_type = LOGAN_ZLIB_ING;
        // 主要看这个方法
        clogan_zlib(model, data, data_len, Z_SYNC_FLUSH);
    } else {
        // 调用 deflateInit2 初始化 zlib
        init_zlib_clogan(model);
    }
}
```

#### clogan_zlib

zlib_util.c

```c
void clogan_zlib(cLogan_model *model, char *data, int data_len, int type) {
    // is_gzip 是指是否初始化 zlib 成功，如果不成功，会直接加密不压缩
    int is_gzip = model->is_ready_gzip;
    int ret;
    if (is_gzip) {
        unsigned int have;
        unsigned char out[LOGAN_CHUNK];
        z_stream *strm = model->strm;
        strm->avail_in = (uInt)data_len;
        strm->next_in = (unsigned char *)data;
        do {
            strm->avail_out = LOGAN_CHUNK;
            strm->next_out = (unsigned char *)out;
            ret = deflate(strm, type);
            if (Z_STREAM_ERROR == ret) {
                deflateEnd(model->strm);
                model->is_ready_gzip = 0;
                model->zlib_type = LOGAN_ZLIB_END;
            } else {
                // have 是压缩结果的大小，avail_out 是指目标数组还有多大可用，块总数-剩余可用，就是压缩结果
                have = LOGAN_CHUNK - strm->avail_out;
                // 上次遗留的数据 + 这次压缩结果的大小，就是总数
                int total_len = model->remain_data_len + have;
                unsigned char *temp = NULL;
                // 对齐 16，本次 16 倍数长度的数据会参与加密写入，剩余的遗留到下次
                int handler_len = (total_len / 16) * 16;
                // 剩余数据长度
                int remain_len = total_len % 16;
                if (handler_len) {
                    // 对齐后的压缩数据长度
                    int copy_data_len = handler_len - model->remain_data_len;
                    char gzip_data[handler_len];
                    temp = (unsigned char *)gzip_data;
                    // 先填充上次遗留的数据
                    if (model->remain_data_len) {
                        memcpy(temp, model->remain_data,
                               model->remain_data_len);
                        temp += model->remain_data_len;
                    }
                    // 填充压缩数据
                    memcpy(temp, out, copy_data_len); 
                    // 加密，加密后的数据写入 model->last_point 中
                    aes_encrypt_clogan(
                        (unsigned char *)gzip_data, model->last_point,
                        handler_len,
                        (unsigned char *)model->aes_iv); //把加密数据写入缓存
                    // 更新长度
                    model->total_len += handler_len;
                    model->content_len += handler_len;
                    model->last_point += handler_len;
                }
                if (remain_len) {
                    if (handler_len) {
                        // 有剩余，算出剩余数据开始的位置，填充到 model->remain_data 中
                        int copy_data_len =
                            handler_len - model->remain_data_len;
                        temp = (unsigned char *)out;
                        temp += copy_data_len;
                        memcpy(model->remain_data, temp,
                               remain_len); //填充剩余数据和压缩数据
                    } else {
                        // 本次压缩结果长度根本没到 16，直接全部填充到 model->remain_data 中
                        temp = (unsigned char *)model->remain_data;
                        temp += model->remain_data_len;
                        memcpy(temp, out, have);
                    }
                }
                // 更新剩余数据长度
                model->remain_data_len = remain_len;
            }
        // 只要每次存放压缩结果的数组都被填满了，就继续压缩；直到有空余，说明压缩结束了
        } while (strm->avail_out == 0);
    } 
    // zlib 初始化失败了
    else {
        // 总数是上次剩余数据 + 本次数据
        int total_len = model->remain_data_len + data_len;
        unsigned char *temp = NULL;
        // 对齐 16
        int handler_len = (total_len / 16) * 16;
        // 新的剩余长度
        int remain_len = total_len % 16;
        if (handler_len) {
            int copy_data_len = handler_len - model->remain_data_len;
            char gzip_data[handler_len];
            temp = (unsigned char *)gzip_data;
            // 跟上面一样，先填充剩余数据，再填充本次数据
            if (model->remain_data_len) {
                memcpy(temp, model->remain_data, model->remain_data_len);
                temp += model->remain_data_len;
            }
            memcpy(temp, data, copy_data_len); 
            // 加密
            aes_encrypt_clogan((unsigned char *)gzip_data, model->last_point,
                               handler_len, (unsigned char *)model->aes_iv);
            model->total_len += handler_len;
            model->content_len += handler_len;
            model->last_point += handler_len;
        }
        // 跟上面一样
        if (remain_len) {
            if (handler_len) {
                int copy_data_len = handler_len - model->remain_data_len;
                temp = (unsigned char *)data;
                temp += copy_data_len;
                memcpy(model->remain_data, temp,
                       remain_len);
            } else {
                temp = (unsigned char *)model->remain_data;
                temp += model->remain_data_len;
                memcpy(temp, data, data_len);
            }
        }
        model->remain_data_len = remain_len;
    }
}
```

可以看到，先压缩数据，然后按 16 的倍数字节，去加密；多于 16 的倍数部分，放入 remain_data 中，下次再一起加密。

#### clogan_zlib_end_compress

zlib_util.c

```c
void clogan_zlib_end_compress(cLogan_model *model) {
    // 结束压缩
    clogan_zlib(model, NULL, 0, Z_FINISH);
    (void)deflateEnd(model->strm);
    // 需要填充 val 个字节，凑够 16
    int val = 16 - model->remain_data_len;
    char data[16];
    // 这里的填充有点奇怪
    memset(data, val, 16);
    // 复制剩余数据到 data 中
    if (model->remain_data_len) {
        memcpy(data, model->remain_data, model->remain_data_len);
    }
    // 加密
    aes_encrypt_clogan((unsigned char *)data, model->last_point, 16,
                       (unsigned char *)model->aes_iv); //把加密数据写入缓存
    // 写入协议尾、更新指针
    model->last_point += 16;
    *(model->last_point) = LOGAN_WRITE_PROTOCOL_TAIL;
    model->last_point++;
    model->remain_data_len = 0;
    model->total_len += 17;
    model->content_len +=
        16; //为了兼容之前协议content_len,只包含内容,不包含结尾符
    model->zlib_type = LOGAN_ZLIB_END;
    model->is_ready_gzip = 0;
}
```

注意，这里可能并没有剩余数据，此时就会填充一个全是 16 的 16 个字节的数组，然后加密

#### 总结

至此，写日志部分已经分析结束了。主要关注几个地方：日志切块进行压缩加密写入、多条小日志可能处于同一个压缩流中、使用 `aes` 加密的块长度是 16、还有 `flush` 条件。

协议头、日志长度、协议尾并不在压缩加密范围内，实际写入日志文件的格式为：

`协议头(一个字节 '\1') 日志长度(四个字节，不包含协议尾) 压缩加密后的数据 协议尾(一个字节 '\0')`



### flush

#### clogan_flush

clogan_core.c

```c
int clogan_flush(void) {
    int back = CLOGAN_FLUSH_FAIL_INIT;
    if (!is_init_ok || NULL == logan_model) {
        return back;
    }
    // flush
    write_flush_clogan();
    back = CLOGAN_FLUSH_SUCCESS;
    printf_clogan(" clogan_flush > write flush\n");
    return back;
}
```

#### write_flush_clogan

```c
void write_flush_clogan() {
    // 关闭压缩流，写入协议尾，更新长度
    if (logan_model->zlib_type == LOGAN_ZLIB_ING) {
        clogan_zlib_end_compress(logan_model);
        update_length_clogan(logan_model);
    }
    if (logan_model->total_len > LOGAN_WRITEPROTOCOL_HEAER_LENGTH) {
        unsigned char *point = logan_model->total_point;
        // LOGAN_MMAP_TOTALLEN 是 3, total_point 指向长度字段位置，长度字段是 3 个字节，+3 就指向日志协议头了
        point += LOGAN_MMAP_TOTALLEN;
        // flush
        write_dest_clogan(point, sizeof(char), logan_model->total_len, logan_model);
        printf_clogan("write_flush_clogan > logan total len : %d \n", logan_model->total_len);
        clear_clogan(logan_model);
    }
}
```

#### write_dest_clogan

clogan_core.c

```c
//文件写入磁盘、更新文件大小
void write_dest_clogan(void *point, size_t size, size_t length, cLogan_model *loganModel) {
    if (!is_file_exist_clogan(loganModel->file_path)) { //如果文件被删除,再创建一个文件
        if (logan_model->file_stream_type == LOGAN_FILE_OPEN) {
            fclose(logan_model->file);
            logan_model->file_stream_type = LOGAN_FILE_CLOSE;
        }
        if (NULL != _dir_path) {
            if (!is_file_exist_clogan(_dir_path)) {
                makedir_clogan(_dir_path);
            }
            init_file_clogan(logan_model);
            printf_clogan("clogan_write > create log file , restore open file stream \n");
        }
    }
    if (CLOGAN_EMPTY_FILE == loganModel->file_len) { //如果是空文件插入一行CLogan的头文件
        insert_header_file_clogan(loganModel);
    }
    fwrite(point, sizeof(char), logan_model->total_len, logan_model->file);//写入到文件中
    fflush(logan_model->file);
    loganModel->file_len += loganModel->total_len; //修改文件大小
}
```

#### insert_header_file_clogan

这个方法上面没有分析到，主要是对一个空的日志文件，插入一行头文件做标示，格式跟普通的日志一样。

clogan_core.c

```c
//对空的文件插入一行头文件做标示
void insert_header_file_clogan(cLogan_model *loganModel) {
    // 构造日志
    char *log = "clogan header";
    int flag = 1;
    long long local_time = get_system_current_clogan();
    char *thread_name = "clogan";
    long long thread_id = 1;
    int ismain = 1;
    Construct_Data_cLogan *data = construct_json_data_clogan(log, flag, local_time, thread_name,
                                                             thread_id, ismain);
    if (NULL == data) {
        return;
    }
    cLogan_model temp_model; //临时的clogan_model
    int status_header = 1;
    memset(&temp_model, 0, sizeof(cLogan_model));
    if (Z_OK != init_zlib_clogan(&temp_model)) {
        status_header = 0;
    }
    if (status_header) {
        init_encrypt_key_clogan(&temp_model);
        int length = data->data_len * 10;
        unsigned char temp_memory[length];
        memset(temp_memory, 0, length);
        temp_model.total_len = 0;
        temp_model.last_point = temp_memory;
        // 写入协议头
        restore_last_position_clogan(&temp_model);
        // 压缩加密
        clogan_zlib_compress(&temp_model, data->data, data->data_len);
        // 结束压缩，写入协议尾
        clogan_zlib_end_compress(&temp_model);
        update_length_clogan(&temp_model);
        // 写入到日志文件中
        fwrite(temp_memory, sizeof(char), temp_model.total_len, loganModel->file);
        fflush(logan_model->file);
        loganModel->file_len += temp_model.total_len;
    }

    if (temp_model.is_malloc_zlib) {
        free(temp_model.strm);
        temp_model.is_malloc_zlib = 0;
    }
    construct_data_delete_clogan(data);
}
```

#### clear_clogan

clogan_core.c

```c
//对clogan_model数据做还原
void clear_clogan(cLogan_model *logan_model) {
    logan_model->total_len = 0;
    if (logan_model->zlib_type == LOGAN_ZLIB_END) { //因为只有ZLIB_END才会释放掉内存,才能再次初始化
        memset(logan_model->strm, 0, sizeof(z_stream));
        logan_model->zlib_type = LOGAN_ZLIB_NONE;
        init_zlib_clogan(logan_model);
    }
    logan_model->remain_data_len = 0;
    logan_model->content_len = 0;
    logan_model->last_point = logan_model->total_point + LOGAN_MMAP_TOTALLEN;
    // 这个方法会重新写入协议头，所以下次可以直接写入
    restore_last_position_clogan(logan_model);
    init_encrypt_key_clogan(logan_model);
    logan_model->total_len = 0;
    update_length_clogan(logan_model);
    logan_model->total_len = LOGAN_WRITEPROTOCOL_HEAER_LENGTH;
}
```

## 总结

至此，`logan`的代码就分析完成了。

我们可以发现，`logan` 的协议是自定的协议，我们如果需要使用 `Logan`，要么直接使用他开源的后台，要么就自己在自己的日志平台做解析。如果需要自己解析，就需要对这部分内容有所了解，才能进行解析。另一方面，`Logan` 内部有很多关于稳定性的代码，比如多次的文件检查等，是值得借鉴的。