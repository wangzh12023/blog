---
title: "Use scp tool"
date: 2024-12-23
tags: ["shell", "scp"]
---

Today I have to do the task to transfer the prepared data from one server to another. And I find that we can use the tool `scp` to transfer files between two different host or between server and local computer.
<!--more-->

```bash
scp -r path/to/local usernameToObject@ObjectIp:ObjectPathToSave #recursively transfer files in the dir

#Some other command
scp file user@host:/path/to/file   # copying a file to the remote system using scp command
scp user@host:/path/to/file /local/path/to/file   # copying a file from the remote system using scp command

scp <options> source_path destination_path # if we just want to transfer files in the

-r      # transfer directory 
-v      # see the transfer details
-C      # copy files with compression
-l 800  # limit bandwidth with 800
-p      # preserving the original attributes of the copied files
-P      # connection port
-q      # hidden the output

```
