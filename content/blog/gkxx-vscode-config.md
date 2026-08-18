---
title: "Gkxx__的 .vscode"
date: 2024-08-23
tags: ["vscode", "configuration"]
---

翻到已经结课的cs100，Update一下gkxx__的配置文件

~~`你们已经长大了，应该学着自己写configure files了`~~
<!--more-->
> All in `.vscode`

`c_cpp_properties.json`:

```json
{
  "configurations": [
      {
          "name": "Win32",
          "compilerPath": "Your_Path\\mingw64\\bin\\gcc.exe",
          "cStandard": "c17",
          "cppStandard": "c++17",
          "intelliSenseMode": "windows-gcc-x64",
          "compilerArgs": [
              "-Wall",
              "-Wpedantic",
              "-Wextra"
          ]
      }
  ],
  "version": 4
}
```

`settings.json`:

```json
{
  "files.associations": {
    "*.go": "go",
    "iostream": "cpp",
    "array": "cpp",
    "deque": "cpp",
    "string": "cpp",
    "unordered_map": "cpp",
    "vector": "cpp",
    "string_view": "cpp",
    "initializer_list": "cpp",
    "stdexcept": "cpp",
    "iosfwd": "cpp",
    "atomic": "cpp",
    "bit": "cpp",
    "*.tcc": "cpp",
    "cctype": "cpp",
    "clocale": "cpp",
    "cmath": "cpp",
    "compare": "cpp",
    "concepts": "cpp",
    "cstdarg": "cpp",
    "cstddef": "cpp",
    "cstdint": "cpp",
    "cstdio": "cpp",
    "cstdlib": "cpp",
    "cwchar": "cpp",
    "cwctype": "cpp",
    "exception": "cpp",
    "algorithm": "cpp",
    "functional": "cpp",
    "iterator": "cpp",
    "memory": "cpp",
    "memory_resource": "cpp",
    "numeric": "cpp",
    "optional": "cpp",
    "random": "cpp",
    "system_error": "cpp",
    "tuple": "cpp",
    "type_traits": "cpp",
    "utility": "cpp",
    "istream": "cpp",
    "limits": "cpp",
    "new": "cpp",
    "numbers": "cpp",
    "ostream": "cpp",
    "streambuf": "cpp",
    "typeinfo": "cpp",
    "stdbool.h": "c",
    "map": "cpp",
    "set": "cpp"
  }
}
```

`tasks.json`:
```json
{
  "tasks": [
    {
      "type": "cppbuild",
      "label": "C/C++: gcc.exe 生成活动文件",
      "command": "Your_Path\\mingw64\\bin\\gcc.exe",
      "args": [
        "-fdiagnostics-color=always",
        "-g",
        "${file}",
        "-o",
        "${fileDirname}\\${fileBasenameNoExtension}.exe"
      ],
      "options": {
        "cwd": "${fileDirname}"
      },
      "problemMatcher": [
        "$gcc"
      ],
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "detail": "调试器生成的任务。"
    }
  ],
  "version": "2.0.0"
}
```
