// Generated from the project-root src/ directory by npm run build. Do not edit directly.
/* proper-lockfile
The MIT License (MIT)

Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/
/* graceful-fs
The ISC License

Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

*/
/* retry
Copyright (c) 2011:
Tim Koschützki (tim@debuggable.com)
Felix Geisendörfer (felix@debuggable.com)

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.

*/
/* signal-exit
The ISC License

Copyright (c) 2015, Contributors

Permission to use, copy, modify, and/or distribute this software
for any purpose with or without fee is hereby granted, provided
that the above copyright notice and this permission notice
appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE
LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

*/
import { createRequire as createBundledRequire } from "node:module";
const require = createBundledRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "node_modules/graceful-fs/polyfills.js"(exports, module) {
    var constants = __require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d) {
        cwd = null;
        chdir.call(process, d);
      };
      if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module.exports = patch;
    function patch(fs) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs);
      }
      if (!fs.lutimes) {
        patchLutimes(fs);
      }
      fs.chown = chownFix(fs.chown);
      fs.fchown = chownFix(fs.fchown);
      fs.lchown = chownFix(fs.lchown);
      fs.chmod = chmodFix(fs.chmod);
      fs.fchmod = chmodFix(fs.fchmod);
      fs.lchmod = chmodFix(fs.lchmod);
      fs.chownSync = chownFixSync(fs.chownSync);
      fs.fchownSync = chownFixSync(fs.fchownSync);
      fs.lchownSync = chownFixSync(fs.lchownSync);
      fs.chmodSync = chmodFixSync(fs.chmodSync);
      fs.fchmodSync = chmodFixSync(fs.fchmodSync);
      fs.lchmodSync = chmodFixSync(fs.lchmodSync);
      fs.stat = statFix(fs.stat);
      fs.fstat = statFix(fs.fstat);
      fs.lstat = statFix(fs.lstat);
      fs.statSync = statFixSync(fs.statSync);
      fs.fstatSync = statFixSync(fs.fstatSync);
      fs.lstatSync = statFixSync(fs.lstatSync);
      if (fs.chmod && !fs.lchmod) {
        fs.lchmod = function(path, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchmodSync = function() {
        };
      }
      if (fs.chown && !fs.lchown) {
        fs.lchown = function(path, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs.rename = typeof fs.rename !== "function" ? fs.rename : (function(fs$rename) {
          function rename2(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb) cb(er);
            });
          }
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename2, fs$rename);
          return rename2;
        })(fs.rename);
      }
      fs.read = typeof fs.read !== "function" ? fs.read : (function(fs$read) {
        function read(fd, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs, fd, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs, fd, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
        return read;
      })(fs.read);
      fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : /* @__PURE__ */ (function(fs$readSync) {
        return function(fd, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs, fd, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      })(fs.readSync);
      function patchLchmod(fs2) {
        fs2.lchmod = function(path, mode, callback) {
          fs2.open(
            path,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err, fd) {
              if (err) {
                if (callback) callback(err);
                return;
              }
              fs2.fchmod(fd, mode, function(err2) {
                fs2.close(fd, function(err22) {
                  if (callback) callback(err2 || err22);
                });
              });
            }
          );
        };
        fs2.lchmodSync = function(path, mode) {
          var fd = fs2.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs2.fchmodSync(fd, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs2.closeSync(fd);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs2) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
          fs2.lutimes = function(path, at, mt, cb) {
            fs2.open(path, constants.O_SYMLINK, function(er, fd) {
              if (er) {
                if (cb) cb(er);
                return;
              }
              fs2.futimes(fd, at, mt, function(er2) {
                fs2.close(fd, function(er22) {
                  if (cb) cb(er2 || er22);
                });
              });
            });
          };
          fs2.lutimesSync = function(path, at, mt) {
            var fd = fs2.openSync(path, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs2.futimesSync(fd, at, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs2.closeSync(fd);
                } catch (er) {
                }
              } else {
                fs2.closeSync(fd);
              }
            }
            return ret;
          };
        } else if (fs2.futimes) {
          fs2.lutimes = function(_a, _b, _c, cb) {
            if (cb) process.nextTick(cb);
          };
          fs2.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig) return orig;
        return function(target, mode, cb) {
          return orig.call(fs, target, mode, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig) return orig;
        return function(target, mode) {
          try {
            return orig.call(fs, target, mode);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig) return orig;
        return function(target, uid, gid, cb) {
          return orig.call(fs, target, uid, gid, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig) return orig;
        return function(target, uid, gid) {
          try {
            return orig.call(fs, target, uid, gid);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig) return orig;
        return function(target, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0) stats.uid += 4294967296;
              if (stats.gid < 0) stats.gid += 4294967296;
            }
            if (cb) cb.apply(this, arguments);
          }
          return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig) return orig;
        return function(target, options) {
          var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "node_modules/graceful-fs/legacy-streams.js"(exports, module) {
    var Stream = __require("stream").Stream;
    module.exports = legacy;
    function legacy(fs) {
      return {
        ReadStream,
        WriteStream
      };
      function ReadStream(path, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path, options);
        Stream.call(this);
        var self = this;
        this.path = path;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding) this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs.open(this.path, this.flags, this.mode, function(err, fd) {
          if (err) {
            self.emit("error", err);
            self.readable = false;
            return;
          }
          self.fd = fd;
          self.emit("open", fd);
          self._read();
        });
      }
      function WriteStream(path, options) {
        if (!(this instanceof WriteStream)) return new WriteStream(path, options);
        Stream.call(this);
        this.path = path;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "node_modules/graceful-fs/clone.js"(exports, module) {
    "use strict";
    module.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "node_modules/graceful-fs/graceful-fs.js"(exports, module) {
    var fs = __require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util = __require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = /* @__PURE__ */ Symbol.for("graceful-fs.queue");
      previousSymbol = /* @__PURE__ */ Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue2) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue2;
        }
      });
    }
    var debug = noop;
    if (util.debuglog)
      debug = util.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug = function() {
        var m = util.format.apply(util, arguments);
        m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
        console.error(m);
      };
    if (!fs[gracefulQueue]) {
      queue = global[gracefulQueue] || [];
      publishQueue(fs, queue);
      fs.close = (function(fs$close) {
        function close(fd, cb) {
          return fs$close.call(fs, fd, function(err) {
            if (!err) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      })(fs.close);
      fs.closeSync = (function(fs$closeSync) {
        function closeSync(fd) {
          fs$closeSync.apply(fs, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync;
      })(fs.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug(fs[gracefulQueue]);
          __require("assert").equal(fs[gracefulQueue].length, 0);
        });
      }
    }
    var queue;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs[gracefulQueue]);
    }
    module.exports = patch(clone(fs));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
      module.exports = patch(fs);
      fs.__patched = true;
    }
    function patch(fs2) {
      polyfills(fs2);
      fs2.gracefulify = patch;
      fs2.createReadStream = createReadStream2;
      fs2.createWriteStream = createWriteStream;
      var fs$readFile = fs2.readFile;
      fs2.readFile = readFile2;
      function readFile2(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path, options, cb);
        function go$readFile(path2, options2, cb2, startTime) {
          return fs$readFile(path2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs2.writeFile;
      fs2.writeFile = writeFile;
      function writeFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path, data, options, cb);
        function go$writeFile(path2, data2, options2, cb2, startTime) {
          return fs$writeFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs2.appendFile;
      if (fs$appendFile)
        fs2.appendFile = appendFile;
      function appendFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path, data, options, cb);
        function go$appendFile(path2, data2, options2, cb2, startTime) {
          return fs$appendFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs2.copyFile;
      if (fs$copyFile)
        fs2.copyFile = copyFile;
      function copyFile(src, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src, dest, flags, cb);
        function go$copyFile(src2, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src2, dest2, flags2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs2.readdir;
      fs2.readdir = readdir2;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir2(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, options2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path, options, cb);
        function fs$readdirCallback(path2, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path2, options2, cb2],
                err,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs2);
        ReadStream = legStreams.ReadStream;
        WriteStream = legStreams.WriteStream;
      }
      var fs$ReadStream = fs2.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs2.WriteStream;
      if (fs$WriteStream) {
        WriteStream.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs2, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs2, "WriteStream", {
        get: function() {
          return WriteStream;
        },
        set: function(val) {
          WriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs2, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream;
      Object.defineProperty(fs2, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open2(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
            that.read();
          }
        });
      }
      function WriteStream(path, options) {
        if (this instanceof WriteStream)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open2(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
          }
        });
      }
      function createReadStream2(path, options) {
        return new fs2.ReadStream(path, options);
      }
      function createWriteStream(path, options) {
        return new fs2.WriteStream(path, options);
      }
      var fs$open = fs2.open;
      fs2.open = open2;
      function open2(path, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path, flags, mode, cb);
        function go$open(path2, flags2, mode2, cb2, startTime) {
          return fs$open(path2, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path2, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs2;
    }
    function enqueue(elem) {
      debug("ENQUEUE", elem[0].name, elem[1]);
      fs[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i = 0; i < fs[gracefulQueue].length; ++i) {
        if (fs[gracefulQueue][i].length > 2) {
          fs[gracefulQueue][i][3] = now;
          fs[gracefulQueue][i][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs[gracefulQueue].length === 0)
        return;
      var elem = fs[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// node_modules/retry/lib/retry_operation.js
var require_retry_operation = __commonJS({
  "node_modules/retry/lib/retry_operation.js"(exports, module) {
    function RetryOperation(timeouts, options) {
      if (typeof options === "boolean") {
        options = { forever: options };
      }
      this._originalTimeouts = JSON.parse(JSON.stringify(timeouts));
      this._timeouts = timeouts;
      this._options = options || {};
      this._maxRetryTime = options && options.maxRetryTime || Infinity;
      this._fn = null;
      this._errors = [];
      this._attempts = 1;
      this._operationTimeout = null;
      this._operationTimeoutCb = null;
      this._timeout = null;
      this._operationStart = null;
      if (this._options.forever) {
        this._cachedTimeouts = this._timeouts.slice(0);
      }
    }
    module.exports = RetryOperation;
    RetryOperation.prototype.reset = function() {
      this._attempts = 1;
      this._timeouts = this._originalTimeouts;
    };
    RetryOperation.prototype.stop = function() {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      this._timeouts = [];
      this._cachedTimeouts = null;
    };
    RetryOperation.prototype.retry = function(err) {
      if (this._timeout) {
        clearTimeout(this._timeout);
      }
      if (!err) {
        return false;
      }
      var currentTime = (/* @__PURE__ */ new Date()).getTime();
      if (err && currentTime - this._operationStart >= this._maxRetryTime) {
        this._errors.unshift(new Error("RetryOperation timeout occurred"));
        return false;
      }
      this._errors.push(err);
      var timeout = this._timeouts.shift();
      if (timeout === void 0) {
        if (this._cachedTimeouts) {
          this._errors.splice(this._errors.length - 1, this._errors.length);
          this._timeouts = this._cachedTimeouts.slice(0);
          timeout = this._timeouts.shift();
        } else {
          return false;
        }
      }
      var self = this;
      var timer = setTimeout(function() {
        self._attempts++;
        if (self._operationTimeoutCb) {
          self._timeout = setTimeout(function() {
            self._operationTimeoutCb(self._attempts);
          }, self._operationTimeout);
          if (self._options.unref) {
            self._timeout.unref();
          }
        }
        self._fn(self._attempts);
      }, timeout);
      if (this._options.unref) {
        timer.unref();
      }
      return true;
    };
    RetryOperation.prototype.attempt = function(fn, timeoutOps) {
      this._fn = fn;
      if (timeoutOps) {
        if (timeoutOps.timeout) {
          this._operationTimeout = timeoutOps.timeout;
        }
        if (timeoutOps.cb) {
          this._operationTimeoutCb = timeoutOps.cb;
        }
      }
      var self = this;
      if (this._operationTimeoutCb) {
        this._timeout = setTimeout(function() {
          self._operationTimeoutCb();
        }, self._operationTimeout);
      }
      this._operationStart = (/* @__PURE__ */ new Date()).getTime();
      this._fn(this._attempts);
    };
    RetryOperation.prototype.try = function(fn) {
      console.log("Using RetryOperation.try() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = function(fn) {
      console.log("Using RetryOperation.start() is deprecated");
      this.attempt(fn);
    };
    RetryOperation.prototype.start = RetryOperation.prototype.try;
    RetryOperation.prototype.errors = function() {
      return this._errors;
    };
    RetryOperation.prototype.attempts = function() {
      return this._attempts;
    };
    RetryOperation.prototype.mainError = function() {
      if (this._errors.length === 0) {
        return null;
      }
      var counts = {};
      var mainError = null;
      var mainErrorCount = 0;
      for (var i = 0; i < this._errors.length; i++) {
        var error = this._errors[i];
        var message = error.message;
        var count = (counts[message] || 0) + 1;
        counts[message] = count;
        if (count >= mainErrorCount) {
          mainError = error;
          mainErrorCount = count;
        }
      }
      return mainError;
    };
  }
});

// node_modules/retry/lib/retry.js
var require_retry = __commonJS({
  "node_modules/retry/lib/retry.js"(exports) {
    var RetryOperation = require_retry_operation();
    exports.operation = function(options) {
      var timeouts = exports.timeouts(options);
      return new RetryOperation(timeouts, {
        forever: options && options.forever,
        unref: options && options.unref,
        maxRetryTime: options && options.maxRetryTime
      });
    };
    exports.timeouts = function(options) {
      if (options instanceof Array) {
        return [].concat(options);
      }
      var opts = {
        retries: 10,
        factor: 2,
        minTimeout: 1 * 1e3,
        maxTimeout: Infinity,
        randomize: false
      };
      for (var key in options) {
        opts[key] = options[key];
      }
      if (opts.minTimeout > opts.maxTimeout) {
        throw new Error("minTimeout is greater than maxTimeout");
      }
      var timeouts = [];
      for (var i = 0; i < opts.retries; i++) {
        timeouts.push(this.createTimeout(i, opts));
      }
      if (options && options.forever && !timeouts.length) {
        timeouts.push(this.createTimeout(i, opts));
      }
      timeouts.sort(function(a, b) {
        return a - b;
      });
      return timeouts;
    };
    exports.createTimeout = function(attempt, opts) {
      var random = opts.randomize ? Math.random() + 1 : 1;
      var timeout = Math.round(random * opts.minTimeout * Math.pow(opts.factor, attempt));
      timeout = Math.min(timeout, opts.maxTimeout);
      return timeout;
    };
    exports.wrap = function(obj, options, methods) {
      if (options instanceof Array) {
        methods = options;
        options = null;
      }
      if (!methods) {
        methods = [];
        for (var key in obj) {
          if (typeof obj[key] === "function") {
            methods.push(key);
          }
        }
      }
      for (var i = 0; i < methods.length; i++) {
        var method = methods[i];
        var original = obj[method];
        obj[method] = function retryWrapper(original2) {
          var op = exports.operation(options);
          var args = Array.prototype.slice.call(arguments, 1);
          var callback = args.pop();
          args.push(function(err) {
            if (op.retry(err)) {
              return;
            }
            if (err) {
              arguments[0] = op.mainError();
            }
            callback.apply(this, arguments);
          });
          op.attempt(function() {
            original2.apply(obj, args);
          });
        }.bind(obj, original);
        obj[method].options = options;
      }
    };
  }
});

// node_modules/retry/index.js
var require_retry2 = __commonJS({
  "node_modules/retry/index.js"(exports, module) {
    module.exports = require_retry();
  }
});

// node_modules/signal-exit/signals.js
var require_signals = __commonJS({
  "node_modules/signal-exit/signals.js"(exports, module) {
    module.exports = [
      "SIGABRT",
      "SIGALRM",
      "SIGHUP",
      "SIGINT",
      "SIGTERM"
    ];
    if (process.platform !== "win32") {
      module.exports.push(
        "SIGVTALRM",
        "SIGXCPU",
        "SIGXFSZ",
        "SIGUSR2",
        "SIGTRAP",
        "SIGSYS",
        "SIGQUIT",
        "SIGIOT"
        // should detect profiler and enable/disable accordingly.
        // see #21
        // 'SIGPROF'
      );
    }
    if (process.platform === "linux") {
      module.exports.push(
        "SIGIO",
        "SIGPOLL",
        "SIGPWR",
        "SIGSTKFLT",
        "SIGUNUSED"
      );
    }
  }
});

// node_modules/signal-exit/index.js
var require_signal_exit = __commonJS({
  "node_modules/signal-exit/index.js"(exports, module) {
    var process2 = global.process;
    var processOk = function(process3) {
      return process3 && typeof process3 === "object" && typeof process3.removeListener === "function" && typeof process3.emit === "function" && typeof process3.reallyExit === "function" && typeof process3.listeners === "function" && typeof process3.kill === "function" && typeof process3.pid === "number" && typeof process3.on === "function";
    };
    if (!processOk(process2)) {
      module.exports = function() {
        return function() {
        };
      };
    } else {
      assert = __require("assert");
      signals = require_signals();
      isWin = /^win/i.test(process2.platform);
      EE = __require("events");
      if (typeof EE !== "function") {
        EE = EE.EventEmitter;
      }
      if (process2.__signal_exit_emitter__) {
        emitter = process2.__signal_exit_emitter__;
      } else {
        emitter = process2.__signal_exit_emitter__ = new EE();
        emitter.count = 0;
        emitter.emitted = {};
      }
      if (!emitter.infinite) {
        emitter.setMaxListeners(Infinity);
        emitter.infinite = true;
      }
      module.exports = function(cb, opts) {
        if (!processOk(global.process)) {
          return function() {
          };
        }
        assert.equal(typeof cb, "function", "a callback must be provided for exit handler");
        if (loaded === false) {
          load();
        }
        var ev = "exit";
        if (opts && opts.alwaysLast) {
          ev = "afterexit";
        }
        var remove = function() {
          emitter.removeListener(ev, cb);
          if (emitter.listeners("exit").length === 0 && emitter.listeners("afterexit").length === 0) {
            unload();
          }
        };
        emitter.on(ev, cb);
        return remove;
      };
      unload = function unload2() {
        if (!loaded || !processOk(global.process)) {
          return;
        }
        loaded = false;
        signals.forEach(function(sig) {
          try {
            process2.removeListener(sig, sigListeners[sig]);
          } catch (er) {
          }
        });
        process2.emit = originalProcessEmit;
        process2.reallyExit = originalProcessReallyExit;
        emitter.count -= 1;
      };
      module.exports.unload = unload;
      emit = function emit2(event, code, signal) {
        if (emitter.emitted[event]) {
          return;
        }
        emitter.emitted[event] = true;
        emitter.emit(event, code, signal);
      };
      sigListeners = {};
      signals.forEach(function(sig) {
        sigListeners[sig] = function listener() {
          if (!processOk(global.process)) {
            return;
          }
          var listeners = process2.listeners(sig);
          if (listeners.length === emitter.count) {
            unload();
            emit("exit", null, sig);
            emit("afterexit", null, sig);
            if (isWin && sig === "SIGHUP") {
              sig = "SIGINT";
            }
            process2.kill(process2.pid, sig);
          }
        };
      });
      module.exports.signals = function() {
        return signals;
      };
      loaded = false;
      load = function load2() {
        if (loaded || !processOk(global.process)) {
          return;
        }
        loaded = true;
        emitter.count += 1;
        signals = signals.filter(function(sig) {
          try {
            process2.on(sig, sigListeners[sig]);
            return true;
          } catch (er) {
            return false;
          }
        });
        process2.emit = processEmit;
        process2.reallyExit = processReallyExit;
      };
      module.exports.load = load;
      originalProcessReallyExit = process2.reallyExit;
      processReallyExit = function processReallyExit2(code) {
        if (!processOk(global.process)) {
          return;
        }
        process2.exitCode = code || /* istanbul ignore next */
        0;
        emit("exit", process2.exitCode, null);
        emit("afterexit", process2.exitCode, null);
        originalProcessReallyExit.call(process2, process2.exitCode);
      };
      originalProcessEmit = process2.emit;
      processEmit = function processEmit2(ev, arg) {
        if (ev === "exit" && processOk(global.process)) {
          if (arg !== void 0) {
            process2.exitCode = arg;
          }
          var ret = originalProcessEmit.apply(this, arguments);
          emit("exit", process2.exitCode, null);
          emit("afterexit", process2.exitCode, null);
          return ret;
        } else {
          return originalProcessEmit.apply(this, arguments);
        }
      };
    }
    var assert;
    var signals;
    var isWin;
    var EE;
    var emitter;
    var unload;
    var emit;
    var sigListeners;
    var loaded;
    var load;
    var originalProcessReallyExit;
    var processReallyExit;
    var originalProcessEmit;
    var processEmit;
  }
});

// node_modules/proper-lockfile/lib/mtime-precision.js
var require_mtime_precision = __commonJS({
  "node_modules/proper-lockfile/lib/mtime-precision.js"(exports, module) {
    "use strict";
    var cacheSymbol = /* @__PURE__ */ Symbol();
    function probe(file, fs, callback) {
      const cachedPrecision = fs[cacheSymbol];
      if (cachedPrecision) {
        return fs.stat(file, (err, stat) => {
          if (err) {
            return callback(err);
          }
          callback(null, stat.mtime, cachedPrecision);
        });
      }
      const mtime = new Date(Math.ceil(Date.now() / 1e3) * 1e3 + 5);
      fs.utimes(file, mtime, mtime, (err) => {
        if (err) {
          return callback(err);
        }
        fs.stat(file, (err2, stat) => {
          if (err2) {
            return callback(err2);
          }
          const precision = stat.mtime.getTime() % 1e3 === 0 ? "s" : "ms";
          Object.defineProperty(fs, cacheSymbol, { value: precision });
          callback(null, stat.mtime, precision);
        });
      });
    }
    function getMtime(precision) {
      let now = Date.now();
      if (precision === "s") {
        now = Math.ceil(now / 1e3) * 1e3;
      }
      return new Date(now);
    }
    module.exports.probe = probe;
    module.exports.getMtime = getMtime;
  }
});

// node_modules/proper-lockfile/lib/lockfile.js
var require_lockfile = __commonJS({
  "node_modules/proper-lockfile/lib/lockfile.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var fs = require_graceful_fs();
    var retry = require_retry2();
    var onExit = require_signal_exit();
    var mtimePrecision = require_mtime_precision();
    var locks = {};
    function getLockFile(file, options) {
      return options.lockfilePath || `${file}.lock`;
    }
    function resolveCanonicalPath(file, options, callback) {
      if (!options.realpath) {
        return callback(null, path.resolve(file));
      }
      options.fs.realpath(file, callback);
    }
    function acquireLock(file, options, callback) {
      const lockfilePath = getLockFile(file, options);
      options.fs.mkdir(lockfilePath, (err) => {
        if (!err) {
          return mtimePrecision.probe(lockfilePath, options.fs, (err2, mtime, mtimePrecision2) => {
            if (err2) {
              options.fs.rmdir(lockfilePath, () => {
              });
              return callback(err2);
            }
            callback(null, mtime, mtimePrecision2);
          });
        }
        if (err.code !== "EEXIST") {
          return callback(err);
        }
        if (options.stale <= 0) {
          return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
        }
        options.fs.stat(lockfilePath, (err2, stat) => {
          if (err2) {
            if (err2.code === "ENOENT") {
              return acquireLock(file, { ...options, stale: 0 }, callback);
            }
            return callback(err2);
          }
          if (!isLockStale(stat, options)) {
            return callback(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED", file }));
          }
          removeLock(file, options, (err3) => {
            if (err3) {
              return callback(err3);
            }
            acquireLock(file, { ...options, stale: 0 }, callback);
          });
        });
      });
    }
    function isLockStale(stat, options) {
      return stat.mtime.getTime() < Date.now() - options.stale;
    }
    function removeLock(file, options, callback) {
      options.fs.rmdir(getLockFile(file, options), (err) => {
        if (err && err.code !== "ENOENT") {
          return callback(err);
        }
        callback();
      });
    }
    function updateLock(file, options) {
      const lock2 = locks[file];
      if (lock2.updateTimeout) {
        return;
      }
      lock2.updateDelay = lock2.updateDelay || options.update;
      lock2.updateTimeout = setTimeout(() => {
        lock2.updateTimeout = null;
        options.fs.stat(lock2.lockfilePath, (err, stat) => {
          const isOverThreshold = lock2.lastUpdate + options.stale < Date.now();
          if (err) {
            if (err.code === "ENOENT" || isOverThreshold) {
              return setLockAsCompromised(file, lock2, Object.assign(err, { code: "ECOMPROMISED" }));
            }
            lock2.updateDelay = 1e3;
            return updateLock(file, options);
          }
          const isMtimeOurs = lock2.mtime.getTime() === stat.mtime.getTime();
          if (!isMtimeOurs) {
            return setLockAsCompromised(
              file,
              lock2,
              Object.assign(
                new Error("Unable to update lock within the stale threshold"),
                { code: "ECOMPROMISED" }
              )
            );
          }
          const mtime = mtimePrecision.getMtime(lock2.mtimePrecision);
          options.fs.utimes(lock2.lockfilePath, mtime, mtime, (err2) => {
            const isOverThreshold2 = lock2.lastUpdate + options.stale < Date.now();
            if (lock2.released) {
              return;
            }
            if (err2) {
              if (err2.code === "ENOENT" || isOverThreshold2) {
                return setLockAsCompromised(file, lock2, Object.assign(err2, { code: "ECOMPROMISED" }));
              }
              lock2.updateDelay = 1e3;
              return updateLock(file, options);
            }
            lock2.mtime = mtime;
            lock2.lastUpdate = Date.now();
            lock2.updateDelay = null;
            updateLock(file, options);
          });
        });
      }, lock2.updateDelay);
      if (lock2.updateTimeout.unref) {
        lock2.updateTimeout.unref();
      }
    }
    function setLockAsCompromised(file, lock2, err) {
      lock2.released = true;
      if (lock2.updateTimeout) {
        clearTimeout(lock2.updateTimeout);
      }
      if (locks[file] === lock2) {
        delete locks[file];
      }
      lock2.options.onCompromised(err);
    }
    function lock(file, options, callback) {
      options = {
        stale: 1e4,
        update: null,
        realpath: true,
        retries: 0,
        fs,
        onCompromised: (err) => {
          throw err;
        },
        ...options
      };
      options.retries = options.retries || 0;
      options.retries = typeof options.retries === "number" ? { retries: options.retries } : options.retries;
      options.stale = Math.max(options.stale || 0, 2e3);
      options.update = options.update == null ? options.stale / 2 : options.update || 0;
      options.update = Math.max(Math.min(options.update, options.stale / 2), 1e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const operation = retry.operation(options.retries);
        operation.attempt(() => {
          acquireLock(file2, options, (err2, mtime, mtimePrecision2) => {
            if (operation.retry(err2)) {
              return;
            }
            if (err2) {
              return callback(operation.mainError());
            }
            const lock2 = locks[file2] = {
              lockfilePath: getLockFile(file2, options),
              mtime,
              mtimePrecision: mtimePrecision2,
              options,
              lastUpdate: Date.now()
            };
            updateLock(file2, options);
            callback(null, (releasedCallback) => {
              if (lock2.released) {
                return releasedCallback && releasedCallback(Object.assign(new Error("Lock is already released"), { code: "ERELEASED" }));
              }
              unlock(file2, { ...options, realpath: false }, releasedCallback);
            });
          });
        });
      });
    }
    function unlock(file, options, callback) {
      options = {
        fs,
        realpath: true,
        ...options
      };
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        const lock2 = locks[file2];
        if (!lock2) {
          return callback(Object.assign(new Error("Lock is not acquired/owned by you"), { code: "ENOTACQUIRED" }));
        }
        lock2.updateTimeout && clearTimeout(lock2.updateTimeout);
        lock2.released = true;
        delete locks[file2];
        removeLock(file2, options, callback);
      });
    }
    function check(file, options, callback) {
      options = {
        stale: 1e4,
        realpath: true,
        fs,
        ...options
      };
      options.stale = Math.max(options.stale || 0, 2e3);
      resolveCanonicalPath(file, options, (err, file2) => {
        if (err) {
          return callback(err);
        }
        options.fs.stat(getLockFile(file2, options), (err2, stat) => {
          if (err2) {
            return err2.code === "ENOENT" ? callback(null, false) : callback(err2);
          }
          return callback(null, !isLockStale(stat, options));
        });
      });
    }
    function getLocks() {
      return locks;
    }
    onExit(() => {
      for (const file in locks) {
        const options = locks[file].options;
        try {
          options.fs.rmdirSync(getLockFile(file, options));
        } catch (e) {
        }
      }
    });
    module.exports.lock = lock;
    module.exports.unlock = unlock;
    module.exports.check = check;
    module.exports.getLocks = getLocks;
  }
});

// node_modules/proper-lockfile/lib/adapter.js
var require_adapter = __commonJS({
  "node_modules/proper-lockfile/lib/adapter.js"(exports, module) {
    "use strict";
    var fs = require_graceful_fs();
    function createSyncFs(fs2) {
      const methods = ["mkdir", "realpath", "stat", "rmdir", "utimes"];
      const newFs = { ...fs2 };
      methods.forEach((method) => {
        newFs[method] = (...args) => {
          const callback = args.pop();
          let ret;
          try {
            ret = fs2[`${method}Sync`](...args);
          } catch (err) {
            return callback(err);
          }
          callback(null, ret);
        };
      });
      return newFs;
    }
    function toPromise(method) {
      return (...args) => new Promise((resolve3, reject) => {
        args.push((err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve3(result);
          }
        });
        method(...args);
      });
    }
    function toSync(method) {
      return (...args) => {
        let err;
        let result;
        args.push((_err, _result) => {
          err = _err;
          result = _result;
        });
        method(...args);
        if (err) {
          throw err;
        }
        return result;
      };
    }
    function toSyncOptions(options) {
      options = { ...options };
      options.fs = createSyncFs(options.fs || fs);
      if (typeof options.retries === "number" && options.retries > 0 || options.retries && typeof options.retries.retries === "number" && options.retries.retries > 0) {
        throw Object.assign(new Error("Cannot use retries with the sync api"), { code: "ESYNC" });
      }
      return options;
    }
    module.exports = {
      toPromise,
      toSync,
      toSyncOptions
    };
  }
});

// node_modules/proper-lockfile/index.js
var require_proper_lockfile = __commonJS({
  "node_modules/proper-lockfile/index.js"(exports, module) {
    "use strict";
    var lockfile2 = require_lockfile();
    var { toPromise, toSync, toSyncOptions } = require_adapter();
    async function lock(file, options) {
      const release = await toPromise(lockfile2.lock)(file, options);
      return toPromise(release);
    }
    function lockSync(file, options) {
      const release = toSync(lockfile2.lock)(file, toSyncOptions(options));
      return toSync(release);
    }
    function unlock(file, options) {
      return toPromise(lockfile2.unlock)(file, options);
    }
    function unlockSync(file, options) {
      return toSync(lockfile2.unlock)(file, toSyncOptions(options));
    }
    function check(file, options) {
      return toPromise(lockfile2.check)(file, options);
    }
    function checkSync(file, options) {
      return toSync(lockfile2.check)(file, toSyncOptions(options));
    }
    module.exports = lock;
    module.exports.lock = lock;
    module.exports.unlock = unlock;
    module.exports.lockSync = lockSync;
    module.exports.unlockSync = unlockSync;
    module.exports.check = check;
    module.exports.checkSync = checkSync;
  }
});

// src/extension.ts
import {
  execFileSync
} from "node:child_process";
import { randomUUID as randomUUID3 } from "node:crypto";
import { createServer } from "node:http";
import { mkdir as mkdir2 } from "node:fs/promises";
import { basename, dirname as dirname2, join as join3, relative, resolve as resolve2 } from "node:path";
import {
  CanvasError,
  createCanvas,
  defineFactory,
  isFactoryRunTerminal,
  joinSession
} from "@github/copilot-sdk/extension";

// tandem-client:client.ts
var client_default = '(()=>{var Kt=Object.create;var st=Object.defineProperty;var Wt=Object.getOwnPropertyDescriptor;var zt=Object.getOwnPropertyNames;var Ot=Object.getPrototypeOf,Gt=Object.prototype.hasOwnProperty;var Qt=(t,n,a,s)=>{if(n&&typeof n=="object"||typeof n=="function")for(let i of zt(n))!Gt.call(t,i)&&i!==a&&st(t,i,{get:()=>n[i],enumerable:!(s=Wt(n,i))||s.enumerable});return t};var jt=(t,n,a)=>(a=t!=null?Kt(Ot(t)):{},Qt(n||!t||!t.__esModule?st(a,"default",{value:t,enumerable:!0}):a,t));const e={stage:document.getElementById("stage"),currentStage:document.getElementById("current-stage"),currentStageIndex:document.getElementById("current-stage-index"),phase:document.getElementById("phase"),goal:document.getElementById("goal"),status:document.getElementById("status"),connectionStatus:document.getElementById("connection-status"),nextActionGuide:document.getElementById("next-action-guide"),questionHost:document.getElementById("question-host"),confirmed:document.getElementById("confirmed"),assumed:document.getElementById("assumed"),deferred:document.getElementById("deferred"),artifactList:document.getElementById("artifact-list"),artifactCount:document.getElementById("artifact-count"),artifactHeading:document.getElementById("artifact-heading"),artifactMeta:document.getElementById("artifact-meta"),artifactContent:document.getElementById("artifact-content"),artifactDiagram:document.getElementById("artifact-diagram"),artifactReview:document.getElementById("artifact-review"),artifactReviewThreads:document.getElementById("artifact-review-threads"),mermaidHost:document.getElementById("mermaid-host"),mermaidSource:document.getElementById("mermaid-source"),diagramStatus:document.getElementById("diagram-status"),diagramSourceDetails:document.getElementById("diagram-source-details"),contentCard:document.getElementById("content-card"),contentEmpty:document.getElementById("content-empty"),preparationTab:document.getElementById("preparation-tab"),preparationPanel:document.getElementById("preparation-panel"),requirementsTab:document.getElementById("design-tree-tab"),preparationStageTitle:document.getElementById("preparation-stage-title"),preparationStageProgress:document.getElementById("preparation-stage-progress"),preparationStageStatus:document.getElementById("preparation-stage-status"),preparationWorkItems:document.getElementById("preparation-work-items"),preparationResultSummary:document.getElementById("preparation-result-summary"),preparationResultSuggestions:document.getElementById("preparation-result-suggestions"),preparationResultChecks:document.getElementById("preparation-result-checks"),preparationResultSources:document.getElementById("preparation-result-sources"),preparationMessages:document.getElementById("preparation-messages"),preparationStageMessage:document.getElementById("preparation-stage-message"),retryPreparation:document.getElementById("retry-preparation"),designTreePanel:document.getElementById("design-tree-panel"),designTreeCard:document.getElementById("design-tree-card"),designTreeEmpty:document.getElementById("design-tree-empty"),designTreeCurrent:document.getElementById("design-tree-current"),designTreePhase:document.getElementById("design-tree-phase"),designTreeHost:document.getElementById("design-tree-host"),decisionList:document.getElementById("decision-list"),designTreeStatus:document.getElementById("design-tree-status"),designTreeSource:document.getElementById("design-tree-source"),designTreeSourceDetails:document.getElementById("design-tree-source-details"),designReviewTab:document.getElementById("design-review-tab"),reviewCount:document.getElementById("review-count"),designReviewPanel:document.getElementById("design-review-panel"),productDesignSubstage:document.getElementById("product-design-substage"),testDesignSubstage:document.getElementById("test-design-substage"),designReviewTitle:document.getElementById("design-review-title"),designReviewProgress:document.getElementById("design-review-progress"),finishReview:document.getElementById("finish-review"),designReviewThreads:document.getElementById("design-review-threads"),designReviewForm:document.getElementById("design-review-form"),reviewRequestKind:document.getElementById("review-request-kind"),designReviewInput:document.getElementById("design-review-input"),designReviewStatus:document.getElementById("design-review-status"),designReviewStageStatus:document.getElementById("design-review-stage-status"),reviewSubmit:document.getElementById("review-submit"),planTab:document.getElementById("plan-tab"),planPanel:document.getElementById("plan-panel"),planProgress:document.getElementById("plan-progress"),planMaxAgents:document.getElementById("plan-max-agents"),generatePlan:document.getElementById("generate-plan"),finalizePlan:document.getElementById("finalize-plan"),planMetrics:document.getElementById("plan-metrics"),planStrategySection:document.getElementById("plan-strategy-section"),planStrategy:document.getElementById("plan-strategy"),planDagSection:document.getElementById("plan-dag-section"),planDag:document.getElementById("plan-dag"),planDagStatus:document.getElementById("plan-dag-status"),planColumns:document.getElementById("plan-columns"),planWaves:document.getElementById("plan-waves"),planWorkItems:document.getElementById("plan-work-items"),planAgents:document.getElementById("plan-agents"),planRisks:document.getElementById("plan-risks"),planRevisionSection:document.getElementById("plan-revision-section"),planRevisionForm:document.getElementById("plan-revision-form"),planRevisionInput:document.getElementById("plan-revision-input"),optimizePlan:document.getElementById("optimize-plan"),revisePlan:document.getElementById("revise-plan"),planStatus:document.getElementById("plan-status"),implementationTab:document.getElementById("implementation-tab"),implementationPanel:document.getElementById("implementation-panel"),implementationProgress:document.getElementById("implementation-progress"),implementationProgressLabel:document.getElementById("implementation-progress-label"),implementationProgressBar:document.getElementById("implementation-progress-bar"),implementationMetrics:document.getElementById("implementation-metrics"),implementationWaves:document.getElementById("implementation-waves"),implementationWorkItems:document.getElementById("implementation-work-items"),implementationAgents:document.getElementById("implementation-agents"),implementationStrategyForm:document.getElementById("implementation-strategy-form"),implementationStrategyInput:document.getElementById("implementation-strategy-input"),submitImplementationStrategy:document.getElementById("submit-implementation-strategy"),implementationStrategies:document.getElementById("implementation-strategies"),implementationEvents:document.getElementById("implementation-events"),implementationStatus:document.getElementById("implementation-status"),startImplementation:document.getElementById("start-implementation"),stopImplementation:document.getElementById("stop-implementation"),testTab:document.getElementById("test-tab"),testPanel:document.getElementById("test-panel"),testProgress:document.getElementById("test-progress"),testProgressLabel:document.getElementById("test-progress-label"),testProgressBar:document.getElementById("test-progress-bar"),testMetrics:document.getElementById("test-metrics"),testScenarios:document.getElementById("test-scenarios"),testAgents:document.getElementById("test-agents"),testEvents:document.getElementById("test-events"),testStatus:document.getElementById("test-status"),testErrorToggle:document.getElementById("test-error-toggle"),testErrorDetails:document.getElementById("test-error-details"),startTests:document.getElementById("start-tests"),previewTabs:Array.from(document.querySelectorAll(\'[role="tab"]\')),previewPanel:document.getElementById("live-preview-panel"),contentPanel:document.getElementById("content-panel"),previewTools:document.getElementById("preview-tools"),previewStatus:document.getElementById("preview-status"),previewTab:document.getElementById("live-preview-tab"),prototypeBuilding:document.getElementById("prototype-building"),prototypeBuildingMessage:document.getElementById("prototype-building-message"),prototypeBuildingTitle:document.getElementById("prototype-building-title"),prototypeBuildingElapsed:document.getElementById("prototype-building-elapsed"),prototypeBuildStatus:document.getElementById("prototype-build-status"),startPrototype:document.getElementById("start-prototype"),previewEmpty:document.getElementById("preview-empty"),previewEmptyMessage:document.getElementById("preview-empty-message"),previewFrame:document.getElementById("preview-frame"),openPreview:document.getElementById("open-preview"),workspace:document.getElementById("studio-workspace"),requirements:document.getElementById("requirements-pane"),splitter:document.getElementById("studio-splitter"),reloadButton:document.getElementById("reload-extension"),reloadStatus:document.getElementById("reload-status"),stageList:document.getElementById("stage-list"),completeStage:document.getElementById("complete-stage"),stageMessage:document.getElementById("stage-message"),stageBrowsing:document.getElementById("stage-browsing"),reopenStage:document.getElementById("reopen-stage"),requirementsSubstageSection:document.getElementById("requirements-substage-section"),usageSubstage:document.getElementById("usage-substage"),dagSubstage:document.getElementById("dag-substage"),usageIntake:document.getElementById("usage-intake"),usageItems:document.getElementById("usage-items"),usageForm:document.getElementById("usage-form"),usageInput:document.getElementById("usage-input"),addUsage:document.getElementById("add-usage"),usageSuggestionArea:document.getElementById("usage-suggestion-area"),usageSuggestions:document.getElementById("usage-suggestions"),generateDag:document.getElementById("generate-dag"),usageMessage:document.getElementById("usage-message"),prototypeReview:document.getElementById("prototype-review"),revisionForm:document.getElementById("revision-form"),revisionInput:document.getElementById("revision-input"),submitRevision:document.getElementById("submit-revision"),revisionQuestion:document.getElementById("revision-question"),revisionQuestionTitle:document.getElementById("revision-question-title"),revisionQuestionRationale:document.getElementById("revision-question-rationale"),revisionQuestionForm:document.getElementById("revision-question-form"),revisionQuestionChoices:document.getElementById("revision-question-choices"),revisionQuestionDetail:document.getElementById("revision-question-detail"),submitClarification:document.getElementById("submit-clarification"),revisionHistory:document.getElementById("revision-history"),revisionStatus:document.getElementById("revision-status")},rt=280,Ut=360,wt=.24,ot=24,z=[{id:"prepare",label:"Preparation"},{id:"requirements",label:"Requirements"},{id:"prototype",label:"Prototype"},{id:"design",label:"Design"},{id:"plan",label:"Plan"},{id:"implement",label:"Implement"},{id:"test",label:"Test"}];let v=null,A=!1,ee=!1,Ae=0,_=!1,Y=!1,ne=!1,ae=null,Be=null,ke="",L="preparation",U=null,ge=null,ze=!0,Oe=null,fe=null,Me=0,Ee=0,He=0,Se=null,Z=!1,dt="",H=!1,lt="",ct="",oe=!1,O=!1,ut="",mt="",xe=null,Ie=null,Ue=0,Fe=0,re=null,pt=0,gt="";const Te=new Map,G=new WeakMap,X=new Map,ft=new WeakSet,Ce=new Map,qe=new Map,ve=new WeakMap;let Re="";function ue(t=v){return t?.lifecycle?.currentStage||"prepare"}function D(){return A||_||Y||ne||Z||H||oe}function Q(t,n){return(t?.lifecycle?.skippedStages||[]).find(a=>a.stageId===n)||(n==="prototype"&&t?.prototypeApproach?.mode==="not-applicable"?{stageId:n,reason:t.prototypeApproach.reason||"No graphical interface needs prototype validation."}:null)}function q(t,n=v,a=!1){return!!n&&!Y&&!_&&ue(n)===t&&!Q(n,t)&&(t!=="prototype"||n.prototypeApproach?.mode!=="undecided")&&(a||!(n.lifecycle?.completedStages||[]).includes(t))&&n.provider?.canSubmitAnswers!==!1}function ie(t){return["running","starting"].includes(t.processing?.status)||["starting","running"].includes(t.preparation?.status)||!!(t.preparation?.processing&&!t.preparation.processing.completedAt)||t.suggestionProcessing?.status==="running"||!!t.planning?.processing||["starting","running"].includes(t.implementation?.status)||["starting","running"].includes(t.testing?.status)||t.previewStatus==="starting"||[t.designReview,t.testDesignReview].some(n=>n?.processing||n?.finalizeRequested||(n?.threads||[]).some(a=>["queued","processing"].includes(a.status)))}function me(t,n){return ue(t)===n||(t.lifecycle?.completedStages||[]).includes(n)||(t.lifecycle?.history||[]).some(a=>a.stageId===n)||(t.artifacts||[]).some(a=>a.stage===n)||n==="plan"&&(t.planning?.workItems||[]).length>0||n==="implement"&&(t.implementation?.workItems||[]).length>0||n==="test"&&(t.testing?.scenarios||[]).length>0}function De(t){return{prepare:"preparation",requirements:"design-tree",prototype:"preview",design:"design-review",plan:"plan",implement:"implementation",test:"test"}[t]||"content"}function Vt(t){!v||!me(v,t)||Q(v,t)||(ae=t,ce(De(t),!0))}function te(t){return t?.dataset?.uiKey||t?.id||""}function de(t=document.body){for(const a of t.querySelectorAll("details[data-ui-key]"))a instanceof HTMLDetailsElement&&qe.set(te(a),a.open);const n=document.activeElement;return{focus:t.contains(n)?te(n):"",original:n,start:n?.selectionStart,end:n?.selectionEnd,scroll:Array.from(t.querySelectorAll("[id], [data-ui-key]")).filter(a=>a.scrollTop||a.scrollLeft).map(a=>({key:te(a),top:a.scrollTop,left:a.scrollLeft}))}}function le(t,n=document.body){const a=Array.from(n.querySelectorAll("[id], [data-ui-key]"));for(const i of n.querySelectorAll("details[data-ui-key]"))i instanceof HTMLDetailsElement&&qe.has(te(i))&&(i.open=qe.get(te(i)));for(const i of t.scroll){const r=a.find(d=>te(d)===i.key);r&&(r.scrollTop=i.top,r.scrollLeft=i.left)}const s=a.find(i=>te(i)===t.focus);if(s&&!s.disabled&&!s.closest("[hidden]")&&(!t.original?.isConnected||document.activeElement===t.original)&&(document.activeElement!==s&&s.focus({preventScroll:!0}),typeof t.start=="number"&&typeof s.setSelectionRange=="function"))try{s.setSelectionRange(t.start,t.end)}catch{}}function Jt(t){const n={};for(const a of t.querySelectorAll("input, textarea, select")){const s=a.name||a.id;s&&(a.type==="radio"?n[s+":"+a.value]=a.checked:n[s]=a.value)}return n}function V(t,n=!1){const a=t?.dataset?.draftKey;if(!a)return;const s=X.get(a);X.set(a,{values:Jt(t),version:(s?.version||0)+(n?1:0)})}function Pe(t,n){const a=t.dataset.draftKey;if(a&&a!==n){V(t);for(const i of t.querySelectorAll("textarea, input:not([type=radio])"))i.value="";for(const i of t.querySelectorAll("select"))i.selectedIndex=0}t.dataset.draftKey=n;const s=X.get(n);if(s)for(const i of t.querySelectorAll("input, textarea, select")){const r=i.name||i.id,d=i.type==="radio"?r+":"+i.value:r;d in s.values&&(i.type==="radio"?i.checked=s.values[d]:i.value=s.values[d])}ft.has(t)||(t.addEventListener("input",()=>V(t,!0)),t.addEventListener("change",()=>V(t,!0)),ft.add(t)),V(t)}function Ve(t,n,a=null){return JSON.stringify([v?.prototypeId||"",t,n,a])}function Je(t,n){const a=X.get(t);if(!a||a.version!==n)return;const s=Object.fromEntries(Object.entries(a.values).map(([i,r])=>[i,typeof r=="boolean"?!1:i==="review-request-kind"?"question":""]));X.set(t,{values:s,version:n+1});for(const i of document.querySelectorAll("form[data-draft-key]"))i.dataset.draftKey===t&&Pe(i,t)}function we(t){return{value:t.value,version:ve.get(t)||0}}function be(t,n){t.value===n.value&&(ve.get(t)||0)===n.version&&(t.value="")}for(const t of["input","change"])document.addEventListener(t,n=>{const a=n.target;ve.set(a,(ve.get(a)||0)+1)},!0);function bt(t){const n=Date.parse(t||"");if(!Number.isFinite(n))return"";const a=Math.max(0,Math.floor((Date.now()-n)/1e3));return"Elapsed: "+Math.floor(a/60)+"m "+a%60+"s"}async function M(t,n){const a=++Ue,s=await fetch(t,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(n),signal:AbortSignal.timeout(6e4)}),i=await s.json();if(!s.ok)throw new Error(i.error||"The request failed.");return Mt(i)?at(i,a):await Le(a).catch(()=>{}),i}function j(){A=!1,v&&(P(v,!0),nt(v))}function Et(){const t=e.workspace.getBoundingClientRect(),n=e.splitter.getBoundingClientRect().width||9;return{workspaceRect:t,min:rt,max:Math.max(rt,t.width-n-Ut)}}function $e(t){if(window.matchMedia("(max-width: 760px)").matches)return;const n=Et(),a=Math.round(Math.min(n.max,Math.max(n.min,t)));e.workspace.style.setProperty("--requirements-width",a+"px"),e.splitter.setAttribute("aria-valuemin",String(n.min)),e.splitter.setAttribute("aria-valuemax",String(Math.round(n.max))),e.splitter.setAttribute("aria-valuenow",String(a));const s=n.workspaceRect.width>0?Math.round(a/n.workspaceRect.width*100):wt*100;e.splitter.setAttribute("aria-valuetext",s+"% requirements, "+(100-s)+"% preview")}function St(){if(window.matchMedia("(max-width: 760px)").matches)return;const t=e.requirements.getBoundingClientRect().width;$e(t||e.workspace.clientWidth*wt)}function xt(t){const{workspaceRect:n}=Et();$e(t-n.left)}function _e(t,n){Be===t&&(Be=null,e.splitter.classList.remove("is-dragging"),document.body.classList.remove("is-resizing"),n&&e.splitter.hasPointerCapture(t)&&e.splitter.releasePointerCapture(t))}e.splitter.addEventListener("pointerdown",t=>{t.button!==0||window.matchMedia("(max-width: 760px)").matches||(Be=t.pointerId,e.splitter.setPointerCapture(t.pointerId),e.splitter.classList.add("is-dragging"),document.body.classList.add("is-resizing"),xt(t.clientX),t.preventDefault())});e.splitter.addEventListener("pointermove",t=>{Be===t.pointerId&&xt(t.clientX)});e.splitter.addEventListener("pointerup",t=>{_e(t.pointerId,!0)});e.splitter.addEventListener("pointercancel",t=>{_e(t.pointerId,!0)});e.splitter.addEventListener("lostpointercapture",t=>{_e(t.pointerId,!1)});e.splitter.addEventListener("keydown",t=>{if(t.key!=="ArrowLeft"&&t.key!=="ArrowRight")return;const n=t.key==="ArrowLeft"?-1:1,a=t.shiftKey?ot*2:ot;$e(e.requirements.getBoundingClientRect().width+n*a),t.preventDefault()});window.addEventListener("resize",St);requestAnimationFrame(St);function It(t){const n=t.provider||{},a=t.reloadReceipt,s=n.canReload===!0,i=a?.status==="reloading";e.reloadButton.disabled=!s||i,e.reloadButton.textContent=i?"Reloading...":"Reload latest installed";let r="",d="idle";ke?(r=ke,d="error"):s?a?.status==="reloading"?r=a.message||"Reloading...":a?.status==="success"?(r=a.message||"Reloaded",d="success"):a?.status==="error"?(r=a.message||"Reload failed",d="error"):r="Current session only":r=n.source==="project"?"Available from the user-installed Tandem":"Reload unavailable",e.reloadStatus.textContent=r,e.reloadStatus.dataset.status=d,e.reloadButton.title=s?"Restart this session\'s provider from the latest installed user extension. This does not download updates.":r}e.reloadButton.addEventListener("click",async()=>{if(!e.reloadButton.disabled){ke="",e.reloadButton.disabled=!0,e.reloadButton.textContent="Checking...",e.reloadStatus.textContent="Checking installed user extension...",e.reloadStatus.dataset.status="idle";try{const t=await fetch("/api/reload",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),n=await t.json();if(!t.ok)throw new Error(n.error||"Reload request failed.");e.reloadButton.textContent="Reloading...",e.reloadStatus.textContent="Reloading this session..."}catch(t){ke=t instanceof Error?t.message:"Reload request failed.",v&&It(v)}}});async function Ye(t,n){if(D()||!q("requirements")||v.processing?.status==="running")return!1;A=!0,e.usageMessage.textContent=t==="generate-dag"?"Generating the DAG from your usage list...":"Adding usage and generating suggestions...",e.usageMessage.dataset.status="idle",At(v);try{return await M("/api/answer",{questionId:"usage-intake",answer:n,action:t}),!0}catch(a){return e.usageMessage.textContent=a instanceof Error?a.message:"Could not update requirements.",e.usageMessage.dataset.status="error",!1}finally{j()}}e.usageForm.addEventListener("submit",async t=>{t.preventDefault();const n=we(e.usageInput),a=n.value.trim();if(!a){e.usageMessage.textContent="Enter one usage sentence.",e.usageMessage.dataset.status="error";return}await Ye("add-usage",a)&&be(e.usageInput,n)});e.generateDag.addEventListener("click",()=>{Ye("generate-dag","Generate the requirements DAG from the complete usage list.")});e.revisionForm.addEventListener("submit",async t=>{if(t.preventDefault(),D()||!q("prototype")||e.submitRevision.disabled)return;const n=we(e.revisionInput),a=n.value.trim();if(!a){e.revisionStatus.textContent="Enter a revision suggestion.",e.revisionStatus.dataset.status="error";return}A=!0,e.submitRevision.disabled=!0,e.submitRevision.textContent="Sending...",e.revisionStatus.textContent="";try{await M("/api/revision",{suggestion:a}),be(e.revisionInput,n)}catch(s){e.revisionStatus.textContent=s instanceof Error?s.message:"Could not submit the revision.",e.revisionStatus.dataset.status="error"}finally{j()}});e.revisionQuestionForm.addEventListener("submit",async t=>{if(t.preventDefault(),D()||!q("prototype")||e.submitClarification.disabled)return;const n=v.prototypeReview?.question;if(!n)return;const a=e.revisionQuestionChoices.querySelector(\'input[name="revision-clarification"]:checked\'),i=e.revisionQuestionDetail.value.trim()||a?.value||"",r=e.revisionQuestionForm.dataset.draftKey;V(e.revisionQuestionForm);const d=X.get(r)?.version;if(!i){e.revisionStatus.textContent="Choose an option or enter clarification.",e.revisionStatus.dataset.status="error";return}A=!0,e.submitClarification.disabled=!0,e.submitClarification.textContent="Sending...",e.revisionStatus.textContent="";try{await M("/api/answer",{questionId:n.id,answer:i,action:"clarify-revision"}),Je(r,d)}catch(u){e.revisionStatus.textContent=u instanceof Error?u.message:"Could not submit clarification.",e.revisionStatus.dataset.status="error"}finally{j()}});function Ze(){const t=e.reviewRequestKind.value;return t==="question"?{type:"question",artifactKind:null,label:"Ask question"}:{type:"artifact",artifactKind:t,label:"Generate artifact"}}e.reviewRequestKind.addEventListener("change",()=>{const t=Ze();e.reviewSubmit.textContent=t.label,e.designReviewInput.placeholder=t.type==="question"?"Ask about the design, tradeoffs, behavior, or risks.":t.artifactKind==="diagram"?"Describe the architecture, sequence, state, or workflow diagram to generate.":t.artifactKind==="contract"?"Describe the UI-facing boundary or contract to clarify.":t.artifactKind==="test-scenario"?"Describe the integration boundary or user interaction scenario to test.":"Describe the design decision and tradeoff to record."});e.designReviewForm.addEventListener("submit",async t=>{if(t.preventDefault(),D()||!q("design"))return;const n=we(e.designReviewInput),a=n.value.trim(),s=e.designReviewForm.dataset.draftKey;V(e.designReviewForm);const i=X.get(s)?.version,r=(v.artifacts||[]).find(u=>u.id===U);if(!r||r.stage!=="design"){e.designReviewStatus.textContent="Select a Design artifact before starting a review.",e.designReviewStatus.dataset.status="error";return}if(!a){e.designReviewStatus.textContent="Enter a design question or artifact request.",e.designReviewStatus.dataset.status="error";return}const d=Ze();A=!0,e.reviewSubmit.disabled=!0,e.reviewSubmit.textContent="Queueing...",e.designReviewStatus.textContent="";try{await M("/api/design-review",{prompt:a,type:d.type,artifactKind:d.artifactKind,artifactId:r.id}),Je(s,i),e.designReviewForm.dataset.draftKey===s&&be(e.designReviewInput,n)}catch(u){e.designReviewStatus.textContent=u instanceof Error?u.message:"Could not queue this review request.",e.designReviewStatus.dataset.status="error"}finally{j()}});e.finishReview.addEventListener("click",async()=>{if(!(D()||e.finishReview.disabled||!q("design"))){A=!0,e.finishReview.disabled=!0,e.finishReview.textContent="Capturing review...",e.designReviewStatus.textContent="";try{await M("/api/design-review/finalize",{})}catch(t){e.designReviewStatus.textContent=t instanceof Error?t.message:"Could not finish the design review.",e.designReviewStatus.dataset.status="error"}finally{j()}}});async function Xe(t,n){if(D()||!q("plan")||v.planning?.processing)return!1;const a=Math.max(1,Math.min(30,Number.parseInt(e.planMaxAgents.value,10)||4));A=!0,e.planStatus.textContent="",e.planStatus.dataset.status="idle",P(v,!0);try{return await M("/api/plan/generate",{action:t,instruction:n,maxAgents:a}),!0}catch(s){return e.planStatus.textContent=s instanceof Error?s.message:"Could not generate the execution plan.",e.planStatus.dataset.status="error",!1}finally{j()}}e.generatePlan.addEventListener("click",()=>{const t=(v?.planning?.workItems||[]).length>0;Xe(t?"revise":"generate",t?"Regenerate the complete plan for the selected agent limit while preserving accepted design scope.":"")});e.optimizePlan.addEventListener("click",()=>{Xe("revise","Reduce unnecessary dependencies and file ownership conflicts, widen safe parallel frontiers, balance agent workload, and shorten scheduled elapsed time without dropping scope or validation.")});e.planRevisionForm.addEventListener("submit",async t=>{t.preventDefault();const n=we(e.planRevisionInput),a=n.value.trim();if(!a){e.planStatus.textContent="Describe how the plan should change.",e.planStatus.dataset.status="error";return}await Xe("revise",a)&&be(e.planRevisionInput,n)});e.finalizePlan.addEventListener("click",async()=>{if(!(D()||e.finalizePlan.disabled||!q("plan"))){A=!0,e.finalizePlan.disabled=!0,e.finalizePlan.textContent="Finalizing...",e.planStatus.textContent="";try{await M("/api/plan/finalize",{})}catch(t){e.planStatus.textContent=t instanceof Error?t.message:"Could not finalize the execution plan.",e.planStatus.dataset.status="error"}finally{j()}}});e.startImplementation.addEventListener("click",async()=>{if(!(D()||!q("implement")||e.startImplementation.disabled)){H=!0,e.implementationStatus.textContent="Starting agents...",e.implementationStatus.dataset.status="idle",P(v,!0);try{await M("/api/implementation/start",{}),e.implementationStatus.textContent="Implementation agents are starting."}catch(t){e.implementationStatus.textContent=t instanceof Error?t.message:"Could not start implementation.",e.implementationStatus.dataset.status="error"}finally{H=!1,v&&P(v,!0)}}});e.stopImplementation.addEventListener("click",async()=>{if(!(D()||!q("implement")||e.stopImplementation.disabled)){H=!0,e.implementationStatus.textContent="Stopping agents...",e.implementationStatus.dataset.status="idle",P(v,!0);try{await M("/api/implementation/stop",{})}catch(t){e.implementationStatus.textContent=t instanceof Error?t.message:"Could not stop implementation.",e.implementationStatus.dataset.status="error"}finally{H=!1,v&&P(v,!0)}}});e.implementationStrategyForm.addEventListener("submit",async t=>{if(t.preventDefault(),D()||!q("implement")||e.submitImplementationStrategy.disabled)return;const n=we(e.implementationStrategyInput),a=n.value.trim();if(!a){e.implementationStatus.textContent="Describe how the execution strategy should change.",e.implementationStatus.dataset.status="error";return}H=!0,e.submitImplementationStrategy.disabled=!0,e.submitImplementationStrategy.textContent="Queueing...",e.implementationStatus.textContent="";try{await M("/api/implementation/strategy",{text:a}),be(e.implementationStrategyInput,n)}catch(s){e.implementationStatus.textContent=s instanceof Error?s.message:"Could not queue this adjustment.",e.implementationStatus.dataset.status="error"}finally{H=!1,v&&P(v,!0)}});e.startTests.addEventListener("click",async()=>{if(!(D()||!q("test",v,!0)||e.startTests.disabled)){oe=!0,e.testStatus.textContent="Starting test agents...",e.testStatus.dataset.status="idle",P(v,!0);try{await M("/api/test/start",{}),e.testStatus.textContent="Test agents are starting."}catch(t){e.testStatus.textContent=t instanceof Error?t.message:"Could not start tests.",e.testStatus.dataset.status="error"}finally{oe=!1,v&&P(v,!0)}}});e.testErrorToggle.addEventListener("click",()=>{O=!O,e.testErrorToggle.setAttribute("aria-expanded",String(O)),e.testErrorToggle.textContent=O?"Hide error details":"Show error details",e.testErrorDetails.hidden=!O,O&&e.testErrorDetails.focus()});e.retryPreparation.addEventListener("click",async()=>{if(!(D()||!q("prepare")||v.preparation?.status!=="failed"||ie(v))){Z=!0,e.retryPreparation.disabled=!0,e.retryPreparation.textContent="Retrying...",e.preparationStageMessage.textContent="",e.preparationStageMessage.dataset.status="idle";try{await M("/api/preparation/retry",{}),e.preparationStageMessage.textContent="Preparation retry started."}catch(t){e.preparationStageMessage.textContent=t instanceof Error?t.message:"Could not retry preparation.",e.preparationStageMessage.dataset.status="error"}finally{Z=!1,v&&P(v,!0)}}});e.completeStage.addEventListener("click",async()=>{if(D()||e.completeStage.disabled||!v)return;const t=ue();if(!(t==="prepare"||Q(v,t))){_=!0,e.completeStage.disabled=!0,e.completeStage.textContent="Saving stage output...",e.stageMessage.textContent="",e.stageMessage.dataset.status="idle";try{(await M("/api/stage/complete",{stageId:t})).accepted&&(e.stageMessage.textContent="Collecting evidence and generating the draft feature specification...",e.stageMessage.dataset.status="idle")}catch(n){e.stageMessage.textContent=n instanceof Error?n.message:"Could not complete this stage.",e.stageMessage.dataset.status="error"}finally{_=!1,v&&P(v,!0)}}});e.startPrototype.addEventListener("click",async()=>{if(!(D()||!q("prototype")||ie(v))){ne=!0,e.prototypeBuildStatus.textContent=v.prototypeApproach?.mode==="validate-existing"?"Requesting validation of the existing prototype...":"Requesting prototype build...",e.prototypeBuildStatus.dataset.status="idle",P(v,!0);try{await M("/api/prototype/start",{})}catch(t){e.prototypeBuildStatus.textContent=t instanceof Error?t.message:"Could not start the prototype.",e.prototypeBuildStatus.dataset.status="error"}finally{ne=!1,v&&P(v,!0)}}});e.reopenStage.addEventListener("click",async()=>{if(D()||!v||e.reopenStage.disabled||e.reopenStage.hidden)return;const t=ae;if(Q(v,t))return;const n=z.find(a=>a.id===t)?.label;if(window.confirm(`Reopen ${n}? Its outputs and dependent stage outputs will be marked stale. Saved evidence is retained, but affected stages must be completed again.`)&&!ie(v)){Y=!0,e.stageMessage.textContent="Reopening "+n+"...",e.stageMessage.dataset.status="idle",P(v,!0);try{await M("/api/stage/reopen",{stageId:t}),ae=t,L=De(t)}catch(a){e.stageMessage.textContent=a instanceof Error?a.message:"Could not reopen this stage.",e.stageMessage.dataset.status="error"}finally{Y=!1,v&&P(v,!0)}}});function ce(t,n=!1){const a=["preparation","preview","design-tree","design-review","plan","implementation","test","content"].includes(t)?t:"preparation",s=e.previewTabs.find(i=>i.dataset.tab===a);L=s?.disabled||s?.hidden?e.previewTabs.find(i=>!i.hidden&&!i.disabled)?.dataset.tab||"preparation":a,ae={preparation:"prepare",preview:"prototype","design-tree":"requirements","design-review":"design",plan:"plan",implementation:"implement",test:"test"}[L]||(v?.artifacts||[]).find(i=>i.id===U)?.stage||ue();for(const i of e.previewTabs){const r=i.dataset.tab===L;i.setAttribute("aria-selected",String(r)),i.tabIndex=r?0:-1,r&&n&&i.focus()}e.preparationPanel.hidden=L!=="preparation",e.previewPanel.hidden=L!=="preview",e.designTreePanel.hidden=L!=="design-tree",e.designReviewPanel.hidden=L!=="design-review",e.planPanel.hidden=L!=="plan",e.implementationPanel.hidden=L!=="implementation",e.testPanel.hidden=L!=="test",e.contentPanel.hidden=L!=="content",e.previewTools.hidden=L!=="preview",v&&(Ct(v),he(v))}for(const t of e.previewTabs)t.addEventListener("click",()=>ce(t.dataset.tab)),t.addEventListener("keydown",n=>{const a=e.previewTabs.filter(r=>!r.hidden&&!r.disabled),s=a.indexOf(t);let i=null;n.key==="ArrowLeft"?i=(s-1+a.length)%a.length:n.key==="ArrowRight"?i=(s+1)%a.length:n.key==="Home"?i=0:n.key==="End"&&(i=a.length-1),i!==null&&(ce(a[i].dataset.tab,!0),n.preventDefault())});function Ct(t){const n=ue(t),a=ae||n,s=z.find(d=>d.id===a)?.label||a,i=Q(t,a),r=!!i||a!==n||(t.lifecycle?.completedStages||[]).includes(a);e.stageBrowsing.textContent=i?`${s} is not applicable. ${i.reason} Reopen Requirements to change prototype applicability.`:r?`Viewing ${s} \\xB7 read only. Reopen explicitly to change its scope.`:"",e.completeStage.hidden=a!==n||!!i,e.reopenStage.hidden=!!i||!r||z.findIndex(d=>d.id===a)>z.findIndex(d=>d.id===n),e.reopenStage.textContent=Y?"Reopening...":"Reopen "+s,e.reopenStage.disabled=Y||_||A||ne||Z||H||oe||t.provider?.canSubmitAnswers===!1||ie(t);for(const d of e.stageList.querySelectorAll("button"))d.setAttribute("aria-pressed",String(d.dataset.stageId===a))}function $t(t,n=!1){const a=t.lifecycle||{currentStage:"prepare",completedStages:[],outputs:[],skippedStages:[]},s=new Set(a.completedStages||[]),i=new Map((a.skippedStages||[]).map(l=>[l.stageId,l])),r=new Map([...a.history||[],...a.outputs||[]].map(l=>[l.stageId,l])),d=(t.artifacts||[]).some(l=>l.id==="final-code"&&l.kind==="final-code"&&l.stage==="implement"&&l.path&&l.reviewStatus!=="stale"),u=z.every(l=>s.has(l.id)||!!Q(t,l.id)),p=a.currentStage||"prepare",g=Math.max(0,z.findIndex(l=>l.id===p)),o=z[g];if(e.stageList.replaceChildren(),z.forEach((l,c)=>{const w=s.has(l.id),b=l.id==="prototype"&&t.prototypeApproach?.mode==="not-applicable",f=i.get(l.id)||(b?{stageId:"prototype",reason:t.prototypeApproach?.reason||"No graphical interface needs prototype validation."}:null),h=!!f,x=l.id===p&&!u,T=h?"not applicable":w?"complete":x?"active":"locked",I=document.createElement("li"),m=document.createElement("button");m.className="stage-step",m.type="button",m.dataset.uiKey="stage:"+l.id,m.dataset.stageId=l.id,m.dataset.status=T,m.disabled=h||T==="locked"&&!me(t,l.id),m.setAttribute("aria-current",String(x)),h&&(m.title=f.reason,m.setAttribute("aria-label",`${l.label}, not applicable. ${f.reason}`));const E=document.createElement("span");E.className="stage-step-index",E.textContent=String(c+1);const S=document.createElement("span");S.className="stage-step-label",S.textContent=l.label;const B=document.createElement("span");B.className="stage-step-status",B.textContent=T,m.append(E,S,B);const y=r.get(l.id);if(y&&!h&&(m.title=y.path),m.addEventListener("click",()=>Vt(l.id)),I.append(m),h){const R=document.createElement("p");R.className="stage-step-hint",R.textContent=f.reason,I.append(R)}e.stageList.append(I)}),e.currentStageIndex.textContent=String(g+1),e.stage.textContent=o.label,e.currentStage.setAttribute("aria-label","Current lifecycle stage: "+o.label),e.completeStage.disabled=_||Y||A||ne||Z||H||oe||u||p==="prepare"||t.provider?.canSubmitAnswers===!1||t.processing?.status==="running"||p==="prototype"&&(t.previewStatus!=="ready"||t.prototypeApproach?.mode==="undecided"||!!Q(t,"prototype")||!!t.prototypeReview?.question)||p==="requirements"&&(t.preparation?.status==="not-started"||t.prototypeApproach?.mode==="undecided"||t.requirements?.substage!=="dag"||!Array.isArray(t.decisionGraph?.nodes)||t.decisionGraph.nodes.length===0||t.decisionGraph.nodes.some(l=>!l.answer))||p==="design"&&(!["design-spec","design-review"].includes(t.designReview?.finalizedArtifactId)||!!t.designReview?.processing||!!t.designReview?.finalizeRequested||(t.designReview?.threads||[]).some(l=>l.status!=="resolved")||t.testDesignReview?.finalizedArtifactId!=="test-spec"||!!t.testDesignReview?.processing||!!t.testDesignReview?.finalizeRequested||(t.testDesignReview?.threads||[]).some(l=>l.status!=="resolved"))||p==="plan"&&(t.planning?.status!=="complete"||t.planning?.finalizedArtifactId!=="execution-plan"||!!t.planning?.processing)||p==="implement"&&(t.implementation?.status!=="completed"||t.implementation?.finalizedArtifactId!=="final-code"||!d||(t.implementation?.workItems||[]).some(l=>l.status!=="completed"))||p==="test"&&(t.testing?.status!=="completed"||t.testing?.finalizedArtifactId!=="test-results"||(t.testing?.scenarios||[]).some(l=>l.status!=="passed")),e.completeStage.textContent=u?"All stages complete":_?"Saving stage output...":p==="prepare"?"Preparation runs automatically":t.processing?.status==="running"&&t.processing?.action==="generate-design-spec"?"Generating draft feature spec...":"Finish "+o.label.toLowerCase(),!n){const l=[...a.outputs||[]].pop(),c=i.get("prototype")||(t.prototypeApproach?.mode==="not-applicable"?t.prototypeApproach:null);e.stageMessage.textContent=c&&(!l||l.stageId==="prototype")?"Prototype disabled: "+c.reason:l?"Saved "+l.path:p==="prepare"?"Preparation advances automatically when analysis completes.":"Complete the active stage to unlock the next.",e.stageMessage.dataset.status="idle"}Ct(t)}function Rt(t,n=!1){const a=t.preparation||{status:"not-started",summary:"",workItems:[],messages:[],checks:[],sources:[],suggestedUsages:[],error:""},s=t.preparationRuntime||null,i=["not-started","starting","running"].includes(a.status),r=t.lifecycle?.currentStage||"prepare";e.requirementsTab.disabled=r==="prepare",e.requirementsTab.title=r==="prepare"?"Requirements unlock when preparation completes.":"",e.preparationStageStatus.textContent=a.status.replace("-"," "),e.preparationStageStatus.dataset.status=a.status,e.preparationStageTitle.textContent=i?"Preparing Tandem context":a.status==="failed"?"Preparation needs attention":"Preparation results",e.preparationStageProgress.textContent=s?.currentPhase?"Current phase: "+s.currentPhase.split("-").join(" "):i?t.status||"Preparation is starting.":a.summary||"Preparation has completed.";const d=new Map((s?.agents||[]).map(g=>[String(g.label||"").replace(/^prepare:/,""),g]));e.preparationWorkItems.replaceChildren();for(const g of a.workItems||[]){const o=d.get(g.id)||{},l=o.status==="running"?"running":g.status,c=document.createElement("div");c.className="implementation-card",c.dataset.status=l;const w=document.createElement("div");w.className="implementation-card-heading";const b=document.createElement("strong");b.textContent=g.title;const f=document.createElement("span");f.className="implementation-badge",f.textContent=l,w.append(b,f);const h=document.createElement("p");if(h.className="implementation-meta",h.textContent=g.detail,c.append(w,h),o.activity||g.result){const x=document.createElement("p");x.textContent=o.activity||g.result,c.append(x)}e.preparationWorkItems.append(c)}if((a.workItems||[]).length===0&&$(e.preparationWorkItems,"Preparation work items will appear when analysis starts."),e.preparationResultSummary.textContent=a.summary||"Results will appear as preparation completes.",e.preparationResultSummary.classList.toggle("muted",!a.summary),e.preparationResultChecks.replaceChildren(),e.preparationResultSuggestions.replaceChildren(),(a.suggestedUsages||[]).length>0){const g=document.createElement("strong");g.textContent="Passed to Requirements";const o=document.createElement("ul");ye(o,a.suggestedUsages,"No suggestions generated."),e.preparationResultSuggestions.append(g,o)}for(const g of a.checks||[]){const o=document.createElement("div");o.className="preparation-result-item",o.dataset.status=g.status;const l=document.createElement("strong");l.textContent=g.label+" \\xB7 "+g.status;const c=document.createElement("span");c.textContent=g.detail,o.append(l,c),e.preparationResultChecks.append(o)}e.preparationResultSources.replaceChildren();for(const g of a.sources||[]){const o=document.createElement("a");o.href=g.url,o.target="_blank",o.rel="noreferrer",o.textContent=g.title,o.dataset.uiKey="preparation-source:"+g.url,o.title=g.purpose||g.url,e.preparationResultSources.append(o)}const u=[...(a.messages||[]).map(g=>({id:g.id,text:g.text,kind:g.kind,at:Date.parse(g.at)||0})),...(s?.progress||[]).map(g=>({id:"runtime-"+g.seq,text:g.text,kind:g.kind||"info",at:Number(g.recordedAt)||0}))].sort((g,o)=>o.at-g.at).slice(0,30);e.preparationMessages.replaceChildren();for(const g of u){const o=document.createElement("div");o.className="implementation-event",o.dataset.status=g.kind;const l=document.createElement("div");l.className="implementation-event-heading";const c=document.createElement("p");c.textContent=g.text;const w=document.createElement("time");w.textContent=g.at?new Date(g.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"",l.append(c,w),o.append(l),e.preparationMessages.append(o)}u.length===0&&$(e.preparationMessages,"Preparation progress will appear here.");const p=q("prepare",t);e.retryPreparation.hidden=a.status!=="failed"||r!=="prepare",e.retryPreparation.disabled=D()||!p||ie(t),e.retryPreparation.textContent=Z?"Retrying...":"Retry preparation",n||(e.preparationStageMessage.textContent=a.error||(a.status==="needs-attention"?"Preparation completed with blockers. Requirements suggestions are still available.":a.status==="ready"?"Preparation completed and its suggestions were passed to Requirements.":""),e.preparationStageMessage.dataset.status=a.status==="failed"?"error":"idle")}function At(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="requirements";if(e.requirementsSubstageSection.hidden=!a,!a)return;const s=t.requirements||{substage:Qe(t).length>0?"dag":"usage",usageItems:[],suggestions:[]},i=s.substage!=="dag";e.usageSubstage.dataset.status=i?"active":"complete",e.dagSubstage.dataset.status=i?"locked":"active",e.usageIntake.hidden=!i;const r=Array.isArray(s.usageItems)?s.usageItems:[];if(e.usageItems.replaceChildren(),r.length===0){const o=document.createElement("li");o.className="muted",o.textContent="No usages added yet.",e.usageItems.append(o)}else r.forEach((o,l)=>{const c=document.createElement("li");c.className="usage-item",c.textContent=l+1+". "+o,e.usageItems.append(c)});const d=Array.isArray(s.suggestions)?s.suggestions:[];e.usageSuggestions.replaceChildren();const u=t.processing?.status==="running"||A,p=t.suggestionProcessing?.status==="running";if(e.usageSuggestionArea.hidden=d.length===0&&!p,p&&d.length===0){const o=document.createElement("li");o.className="muted",o.textContent="Generating AI suggestions...",e.usageSuggestions.append(o)}const g=q("requirements",t);for(const o of d){const l=document.createElement("li"),c=document.createElement("button");c.className="usage-suggestion",c.type="button",c.textContent="+ "+o,c.disabled=u||!g,c.addEventListener("click",()=>{Ye("add-usage",o)}),l.append(c),e.usageSuggestions.append(l)}e.usageInput.disabled=u||!g,e.addUsage.disabled=u||!g,e.generateDag.disabled=u||!g||r.length===0,e.addUsage.textContent=u?"Working...":"Add usage",e.generateDag.textContent=t.processing?.action==="generate-dag"?"Generating DAG...":"Generate requirements DAG",n||(e.usageMessage.textContent=g?u?t.status||"Updating requirements...":p?r.length===0?"Starter suggestions are loading; you can add a usage now.":"Usage saved. Suggestions are refreshing; you can keep adding usages.":i?r.length===0?"Add the first usage to receive AI suggestions.":"Add another usage or generate the decision DAG.":"Usage collection is complete. Work through the dynamic DAG.":"Open the installed user-scoped Tandem to edit requirements.",e.usageMessage.dataset.status="idle")}function Ke(t,n){if(t.replaceChildren(),!Array.isArray(n)||n.length===0){const a=document.createElement("li");a.className="empty-item",a.textContent="None yet",t.append(a);return}for(const a of n){const s=document.createElement("li");s.textContent=a,t.append(s)}}function et(){return fe||(fe=import("https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs").then(t=>{const n=t.default;return n.initialize({startOnLoad:!1,securityLevel:"strict",suppressErrorRendering:!0,theme:document.documentElement.dataset.colorMode==="dark"?"dark":"default",flowchart:{htmlLabels:!1,useMaxWidth:!0}}),n}).catch(t=>{throw fe=null,t})),fe}function Ge(t){const n=String(t.getAttribute("viewBox")||"").trim().split(/\\s+/).map(Number);if(n.length===4&&Number.isFinite(n[2])&&n[2]>0)return n[2];const a=Number.parseFloat(t.getAttribute("width")||"");return Number.isFinite(a)&&a>0?a:800}function Bt(t,n){const a=t.previousElementSibling;if(!a?.classList.contains("diagram-toolbar"))return;const s=a.querySelector(".diagram-toolbar-output");s&&(s.textContent=n)}function yt(t){const n=t.querySelector("svg");n&&(Te.set(t.dataset.diagramKey||t.id,{mode:"fit",scale:1}),n.style.width="100%",n.style.minWidth="0",n.style.maxWidth="none",n.style.height="auto",Bt(t,"Fit"))}function We(t,n){const a=t.querySelector("svg");if(!a)return;const s=Math.min(4,Math.max(.25,n));Te.set(t.dataset.diagramKey||t.id,{mode:"scale",scale:s}),a.style.width=`${Ge(a)*s}px`,a.style.minWidth="0",a.style.maxWidth="none",a.style.height="auto",Bt(t,`${Math.round(s*100)}%`)}function tt(t){const n=()=>{const r=Te.get(t.dataset.diagramKey||t.id);r?.mode==="scale"?We(t,r.scale):yt(t)};if(t.previousElementSibling?.classList.contains("diagram-toolbar")){t.previousElementSibling.hidden=!1,n();return}const a=document.createElement("div");a.className="diagram-toolbar",a.setAttribute("role","toolbar"),a.setAttribute("aria-label","Diagram zoom controls");const s=[{action:"out",label:"\\u2212",title:"Zoom out"},{action:"in",label:"+",title:"Zoom in"},{action:"actual",label:"100%",title:"Actual size"},{action:"fit",label:"Fit",title:"Fit diagram"}];for(const r of s){const d=document.createElement("button");d.type="button",d.dataset.uiKey=t.id+":zoom:"+r.action,d.textContent=r.label,d.title=r.title,d.setAttribute("aria-label",r.title),d.addEventListener("click",()=>{if(r.action==="fit"){yt(t);return}if(r.action==="actual"){We(t,1);return}const u=Te.get(t.dataset.diagramKey||t.id),p=t.querySelector("svg"),g=u?.mode==="scale"?u.scale:p?(p.getBoundingClientRect().width||Ge(p))/Ge(p):1;We(t,g*(r.action==="in"?1.25:.8))}),a.append(d)}const i=document.createElement("span");i.className="diagram-toolbar-output",i.setAttribute("aria-live","polite"),a.append(i),t.before(a),n()}function Ne(t){const n=t.previousElementSibling;n?.classList.contains("diagram-toolbar")&&(n.hidden=!0)}async function vt(t){const n=String(t?.mermaid||"").trim(),a="artifact:"+(t?.id||""),s=JSON.stringify([a,n,document.documentElement.dataset.colorMode]);if(G.get(e.mermaidHost)===s)return;G.set(e.mermaidHost,s),e.mermaidHost.dataset.diagramKey=a,e.diagramSourceDetails.dataset.uiKey!==a+":source"&&(e.diagramSourceDetails.open=qe.get(a+":source")??!1),e.diagramSourceDetails.dataset.uiKey=a+":source";const i=++Me;if(e.artifactDiagram.hidden=!n,e.mermaidSource.textContent=n,e.mermaidHost.replaceChildren(),Ne(e.mermaidHost),e.diagramStatus.textContent="",e.diagramStatus.dataset.status="idle",!!n){e.mermaidHost.setAttribute("aria-label",t.title+" workflow diagram"),e.diagramStatus.textContent="Rendering Mermaid diagram...";try{const d=await(await et()).render("tandem-diagram-"+i,n);if(i!==Me)return;const u=de();e.mermaidHost.innerHTML=d.svg,typeof d.bindFunctions=="function"&&d.bindFunctions(e.mermaidHost),tt(e.mermaidHost),le(u),e.diagramStatus.textContent=""}catch{if(i!==Me)return;G.delete(e.mermaidHost),e.diagramStatus.textContent="Mermaid could not render this diagram. The source is available below.",e.diagramStatus.dataset.status="error",e.diagramSourceDetails.open=!0}}}function Qe(t){if(t.requirements?.substage==="usage")return[];const n=Array.isArray(t.decisionGraph?.nodes)?t.decisionGraph.nodes:[];return n.length>0?n:t.question?[{id:t.question.id,title:t.question.text,dependencies:[],question:t.question,answer:null,status:"active"}]:[]}function je(t){return String(t||"").replace(/\\\\/g,"\\\\\\\\").replace(/"/g,"\'").replace(/\\r?\\n/g," ")}function _t(t){const n=new Map,a=["flowchart LR"];t.forEach((s,i)=>{const r="Decision"+i;n.set(r,s),a.push("  "+r+\'["\'+je(s.title)+\'"]\')}),t.forEach((s,i)=>{for(const r of s.dependencies||[]){const d=t.findIndex(u=>u.id===r);d>=0&&a.push("  Decision"+d+" --> Decision"+i)}}),a.push("  classDef answered fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328","  classDef active fill:#ddf4ff,stroke:#0969da,stroke-width:3px,color:#1f2328","  classDef toAnswer fill:#fff8c5,stroke:#bf8700,stroke-width:2px,color:#1f2328");for(const s of["answered","active","toAnswer"]){const i=t.map((r,d)=>r.status===s?"Decision"+d:null).filter(Boolean);i.length>0&&a.push("  class "+i.join(",")+" "+s)}return{source:a.join(`\n`),aliases:n}}function ht(t,n,a){const s=n.find(d=>d.id===a)||null;if(!s||s.status==="toAnswer")return;ge=s.id;for(const d of e.decisionList.querySelectorAll("button"))d.setAttribute("aria-pressed",String(d.dataset.decisionId===s.id));for(const d of e.designTreeHost.querySelectorAll("g.node"))d.dataset.selected=String(d.dataset.decisionId===s.id);const i=["running","error"].includes(t.processing?.status)&&t.processing?.question?.id===s.id?t.processing:null;qt(s.question,i,q("requirements",t)&&t.processing?.status!=="running",s);const r=n.filter(d=>d.status==="toAnswer").length;e.designTreeCurrent.textContent=(s.status==="active"?"Active":"Answered")+" \\xB7 "+s.title+(r>0?" \\xB7 "+r+" to answer":"")}async function kt(t,n,a="answer-decision"){return M("/api/answer",{questionId:t,answer:n,action:a})}function pe(t="",n=!1){ee=!1,Oe=null,t&&(e.designTreeStatus.textContent=t,e.designTreeStatus.dataset.status=n?"error":"success"),v&&he(v)}async function nt(t){if(!ee||A||t!==v)return;if((t.lifecycle?.currentStage||"requirements")!=="requirements"||t.requirements?.substage!=="dag"){pe();return}if(t.processing?.status==="running")return;if(t.processing?.status==="error"){pe(t.processing.message||"Could not apply all recommended answers.",!0);return}const n=(t.decisionGraph?.nodes||[]).find(r=>r.status==="active");if(!n){const r=Ae;Ae=0,pe(r>0?`Applied ${r} recommended ${r===1?"answer":"answers"}.`:"No recommended answers are waiting.");return}if(Oe===n.id)return;const a=String(n.question?.recommended||"").trim();if(!a){pe(`Stopped at "${n.title}" because it has no recommended answer.`,!0);return}A=!0,Oe=n.id,he(t);const s=e.questionHost.querySelector(".all-recommended"),i=e.questionHost.querySelector(".send");s&&(s.disabled=!0,s.textContent="Applying recommendations..."),i&&(i.disabled=!0);try{await kt(n.id,a),Ae+=1}catch(r){pe(r instanceof Error?r.message:"Could not apply all recommended answers.",!0)}finally{j()}}async function Yt(t){const n=Qe(t),a=_t(n),s=a.source;if(e.designTreeCard.hidden=n.length===0,e.designTreeEmpty.hidden=n.length>0,e.designTreePhase.textContent=t.phase||"discovery",n.length===0){++Ee,G.delete(e.designTreeHost),e.designTreeHost.replaceChildren(),e.decisionList.replaceChildren(),Ne(e.designTreeHost),qt(null,t.processing,!1,null);return}const i=n.find(o=>o.status==="active")||null,r=n.find(o=>o.id===ge&&o.status!=="toAnswer"),d=(ze?i:r)||r||i||n.find(o=>o.status==="answered")||null;ge=d?.id||null,d&&ht(t,n,d.id);const u=o=>{const l=de(),c=Qe(v);ze=c.find(w=>w.id===o)?.status==="active",ht(v,c,o),le(l),he(v)},p=JSON.stringify([s,document.documentElement.dataset.colorMode]);if(G.get(e.designTreeHost)===p){for(const o of e.decisionList.querySelectorAll("button")){const l=n.find(c=>c.id===o.dataset.decisionId);o.disabled=!l||l.status==="toAnswer"}return}G.set(e.designTreeHost,p);const g=++Ee;e.designTreeHost.dataset.diagramKey="requirements:"+t.prototypeId,e.designTreeHost.replaceChildren(),Ne(e.designTreeHost),e.designTreeSource.textContent=s,e.designTreeStatus.dataset.status="idle",e.decisionList.replaceChildren(),e.decisionList.hidden=!1;for(const o of n){const l=document.createElement("li"),c=document.createElement("button");c.type="button",c.dataset.uiKey="decision-text:"+o.id,c.dataset.decisionId=o.id,c.textContent=o.title+" \\xB7 "+(o.status==="toAnswer"?"To answer":o.status),c.disabled=o.status==="toAnswer",c.setAttribute("aria-pressed",String(o.id===ge)),c.addEventListener("click",()=>u(o.id)),l.append(c),e.decisionList.append(l)}e.designTreeStatus.textContent="Rendering requirements DAG...";try{const l=await(await et()).render("tandem-design-tree-"+g,s);if(g!==Ee)return;const c=de();e.designTreeHost.innerHTML=l.svg,typeof l.bindFunctions=="function"&&l.bindFunctions(e.designTreeHost),tt(e.designTreeHost);for(const[w,b]of a.aliases){const f=Array.from(e.designTreeHost.querySelectorAll("g.node")).find(m=>m.id.includes("-"+w+"-"));if(!f)continue;const h=b.status==="active",x=b.status==="answered",T=h||x;if(f.dataset.decisionId=b.id,f.dataset.uiKey="decision:"+b.id,f.dataset.status=b.status,f.dataset.selectable=String(T),f.dataset.selected=String(b.id===ge),f.setAttribute("aria-label",b.title+". "+(b.status==="active"?"Active question":b.status==="answered"?"Answered":"To answer")),!T)continue;f.setAttribute("role","button"),f.setAttribute("tabindex","0");const I=()=>u(b.id);f.addEventListener("click",I),f.addEventListener("keydown",m=>{m.key!=="Enter"&&m.key!==" "||(m.preventDefault(),I())})}e.decisionList.hidden=!1,le(c),he(v),e.designTreeStatus.textContent=""}catch{if(g!==Ee)return;G.delete(e.designTreeHost),e.designTreeStatus.textContent="The diagram is unavailable. Select a decision from the list to continue.",e.designTreeStatus.dataset.status="error",e.designTreeSourceDetails.open=!0}}function Zt(t,n){if(!n)return[];const a=new Set(n.sourceThreadIds||[]);return[...t?.designReview?.threads||[],...t?.testDesignReview?.threads||[]].filter(s=>a.has(s.id)||s.reviewArtifactId===n.id||(s.artifactIds||[]).includes(n.id))}function Tt(t,n,a=!1){const s=document.createElement("div");s.className="review-thread-heading";const i=document.createElement("span");i.className="review-thread-kind",i.textContent=n.type==="artifact"?"Artifact \\xB7 "+String(n.artifactKind||"").replace("-"," "):a?"Test design question":"Product design question";const r=document.createElement("span");r.className="review-thread-state",r.textContent=n.status,s.append(i,r),t.append(s)}function Xt(t,n){e.artifactReviewThreads.replaceChildren();const a=n?.stage==="design";if(e.artifactReview.hidden=!a,!a)return;const s=q("design",t);e.designReviewForm.hidden=!s,Pe(e.designReviewForm,Ve("artifact-review",n.id,t.design?.substage||"product")),e.reviewRequestKind.value==="question"&&(e.designReviewInput.placeholder=`Ask about ${n.title}, its tradeoffs, behavior, or risks.`);const i=t.design?.substage==="test"?t.testDesignReview:t.designReview,r=new Set((i?.threads||[]).map(u=>u.id)),d=Zt(t,n);for(const u of d){const p=document.createElement("article");if(p.className="review-thread",p.dataset.status=u.status,Tt(p,u,(t.testDesignReview?.threads||[]).some(l=>l.id===u.id)),!(u.type==="artifact"&&String(u.id||"").startsWith("default-project-"))){const l=document.createElement("p");if(l.className="review-thread-prompt",l.textContent=u.prompt,p.append(l),u.answer){const c=document.createElement("p");c.className="review-thread-answer",c.textContent=u.answer,p.append(c)}else if(["queued","processing"].includes(u.status)){const c=document.createElement("p");c.className="review-thread-answer muted",c.textContent=u.status==="queued"?"Waiting in the Tandem review queue...":"Tandem is preparing a design response...",p.append(c)}}if(u.error){const l=document.createElement("p");l.className="review-thread-error",l.textContent=u.error,p.append(l)}const o=u.status==="answered"?"resolve":u.status==="resolved"?"reopen":u.status==="failed"?"retry":null;if(o&&r.has(u.id)&&s){const l=document.createElement("div");l.className="review-thread-actions";const c=document.createElement("button");c.type="button",c.className="thread-action",c.dataset.threadAction=o,c.dataset.uiKey="artifact-thread:"+u.id+":"+o,c.textContent=o==="resolve"?"Mark resolved":o==="reopen"?"Reopen":"Retry",c.disabled=A||t.provider?.canSubmitAnswers===!1,c.addEventListener("click",()=>Nt(u.id,o)),l.append(c),p.append(l)}e.artifactReviewThreads.append(p)}}function en(t){const n=t.find(s=>s.id===U)||null;if(e.contentCard.hidden=!n,e.contentEmpty.hidden=!!n,!n){e.artifactHeading.textContent="Artifact content",e.artifactMeta.textContent="",e.artifactContent.textContent="",e.artifactContent.hidden=!0,e.artifactReview.hidden=!0,e.artifactReviewThreads.replaceChildren(),vt(null);return}e.artifactHeading.textContent=n.title;const a=z.find(s=>s.id===n.stage)?.label;e.artifactMeta.textContent=[a,n.kind,n.path,n.reviewStatus==="stale"?"stale":""].filter(Boolean).join(" \\xB7 "),e.artifactContent.textContent=n.content||"",e.artifactContent.hidden=!n.content,vt(n),Xt(v,n)}function tn(t){const n=Array.isArray(t)?t:[];n.some(a=>a.id===U)||(U=n[0]?.id||null),e.artifactCount.textContent=n.length>0?"("+n.length+")":"",e.artifactList.replaceChildren();for(const a of z){const s=n.filter(p=>(p.stage||"requirements")===a.id),i=document.createElement("section");i.className="artifact-stage-group",i.setAttribute("aria-label",a.label+" artifacts");const r=document.createElement("h3");r.className="artifact-stage-heading",r.textContent=a.label;const d=document.createElement("span");d.textContent=String(s.length),r.append(d);const u=document.createElement("ul");if(u.className="artifact-stage-items",s.length===0){const p=document.createElement("li");p.className="empty-item",p.textContent="No artifacts yet",u.append(p)}for(const p of s){const g=document.createElement("li"),o=document.createElement("button");o.className="artifact-button",o.type="button",o.dataset.artifactId=p.id,o.dataset.uiKey="artifact:"+p.id,o.setAttribute("aria-current",String(p.id===U));const l=document.createElement("span");l.className="artifact-title",l.textContent=p.title,o.append(l);const c=[p.kind,p.path,p.reviewStatus==="stale"?"stale":""].filter(Boolean).join(" \\xB7 ");if(c){const w=document.createElement("span");w.className="artifact-list-meta",w.textContent=c,o.append(w)}o.addEventListener("click",()=>{U=p.id,P(v,!0),ce("content")}),g.append(o),u.append(g)}i.append(r,u),e.artifactList.append(i)}en(n)}const nn={"add-usage":"Updating usage guidance","generate-dag":"Building requirements DAG","answer-decision":"Applying your decision","change-answer":"Revising dependent decisions","submit-revision":"Reviewing prototype revision","clarify-revision":"Applying your clarification","generate-design-spec":"Preparing design specification"};function qt(t,n,a,s=null){const i=Ve("decision",t?.id,[t,s?.answer||null]),r=JSON.stringify([i,n,a,s?.status,A,ee,Ce.get(i)]);if(gt===r)return;gt=r,V(e.questionHost.querySelector("form")),xe!==null&&(window.clearInterval(xe),xe=null),e.questionHost.replaceChildren();const d=s?.status==="answered"&&n?.status!=="running";if(d){const f=document.createElement("p");f.className="question",f.textContent=t?.text||s.title;const h=document.createElement("p");h.className="muted",h.textContent="Answered";const x=document.createElement("div");x.className="choice";const T=document.createElement("span");if(T.textContent=s.answer||"No answer recorded.",x.append(T),e.questionHost.append(f,h,x),!a)return}if(n?.status==="running"){const f=document.createElement("div");f.className="processing-state",f.setAttribute("role","status"),f.setAttribute("aria-live","polite"),f.setAttribute("aria-atomic","true");const h=document.createElement("span");h.className="processing-indicator",h.setAttribute("aria-hidden","true");const x=document.createElement("span");x.className="processing-copy";const T=document.createElement("span");T.className="processing-heading";const I=document.createElement("strong"),m=document.createElement("span");m.className="processing-dots",m.setAttribute("aria-hidden","true");for(let y=0;y<3;y+=1)m.append(document.createElement("i"));const E=document.createElement("span");E.className="muted";const S=document.createElement("span");S.className="muted",S.setAttribute("role","timer"),S.setAttribute("aria-live","off"),I.textContent=nn[n.action]||"Processing Tandem update",T.append(I,m),x.append(T,E,S),f.append(h,x),e.questionHost.append(f);const B=()=>{E.textContent=n.message||"Waiting for a progress update.",S.textContent=bt(n.requestedAt)};B(),xe=window.setInterval(B,1e3);return}if(n?.status==="error"){const f=document.createElement("p");f.className="processing-error",f.setAttribute("role","alert"),f.textContent=n.message||"Tandem processing failed.",e.questionHost.append(f)}if(!t){const f=document.createElement("p");f.className="muted",f.textContent=n?.status==="success"?"No decision is waiting.":"Preparing the next decision...",e.questionHost.append(f);return}if(!a){const f=document.createElement("p");f.className="provider-notice",f.textContent="Answers are routed through the installed user-scoped Tandem.",e.questionHost.append(f)}const u=document.createElement("p");if(u.className="question",u.textContent=d?"Change this answer":t.text,e.questionHost.append(u),t.rationale&&!d){const f=document.createElement("p");f.className="rationale",f.textContent=t.rationale,e.questionHost.append(f)}const p=document.createElement("form"),g=document.createElement("div");g.className="choices";for(const f of t.choices||[]){const h=document.createElement("label");h.className="choice";const x=document.createElement("input");x.type="radio",x.name="prototype-choice",x.value=f,x.dataset.uiKey="decision:"+t.id+":choice:"+f,x.disabled=A||!a,x.checked=!d&&f===t.recommended;const T=document.createElement("span");if(T.textContent=f,h.append(x,T),f===t.recommended&&!d){const I=document.createElement("span");I.className="recommended",I.textContent="Recommended",h.append(I)}g.append(h)}g.childElementCount>0&&p.append(g);let o=null;t.allowFreeText!==!1&&(o=document.createElement("textarea"),o.name="prototype-detail",o.dataset.uiKey="decision:"+t.id+":detail",o.disabled=A||!a,o.placeholder=t.answerPlaceholder||(g.childElementCount>0?"Optional context":"Enter your answer"),d&&(o.placeholder="Enter a replacement answer"),o.setAttribute("aria-label","Additional answer context"),o.addEventListener("input",()=>{const f=Array.from(p.querySelectorAll(\'input[name="prototype-choice"]\'));if(o.value.trim()){for(const x of f)x.checked=!1;return}const h=f.find(x=>x.value===t.recommended);h&&(h.checked=!0)}),p.append(o));for(const f of p.querySelectorAll(\'input[name="prototype-choice"]\'))f.addEventListener("change",()=>{f.checked&&o&&(o.value="")});const l=document.createElement("div");l.className="actions";const c=document.createElement("button");c.className="send",c.type="submit",c.dataset.uiKey="decision:"+t.id+":send",c.textContent=a?d?"Update answer and dependents":"Use this answer":"Open installed Tandem to answer",c.disabled=A||!a;let w=null;!d&&t.recommended&&a&&(w=document.createElement("button"),w.className="all-recommended",w.type="button",w.dataset.uiKey="decision:"+t.id+":recommended",w.textContent=ee?"Applying recommendations...":"All as Recommended",w.title="Use each active recommendation, updating dependent decisions as the DAG changes.",w.disabled=A||ee,w.addEventListener("click",()=>{D()||ee||!q("requirements")||(ee=!0,Ae=0,nt(v))}));const b=document.createElement("p");b.className="error",b.setAttribute("role","alert"),b.textContent=Ce.get(i)||"",l.append(c),w&&l.append(w),l.append(b),p.append(l),Pe(p,i),p.addEventListener("submit",async f=>{if(f.preventDefault(),D()||!q("requirements")||v.processing?.status==="running")return;const h=p.querySelector(\'input[name="prototype-choice"]:checked\'),T=(o?o.value.trim():"")||h?.value||"";V(p);const I=X.get(i)?.version;if(!T){b.textContent="Choose an option or enter an answer.";return}A=!0,Ce.delete(i),c.disabled=!0,c.textContent="Sending...",b.textContent="";try{await kt(t.id,T,d?"change-answer":"answer-decision"),Je(i,I),ze=!0}catch(m){const E=m instanceof Error?m.message:"Could not send answer.";Ce.set(i,E)}finally{j()}}),e.questionHost.append(p)}function an(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="prototype";if(e.prototypeReview.hidden=!me(t,"prototype")||!!Q(t,"prototype"),e.prototypeReview.hidden)return;const s=t.prototypeReview||{revisions:[],activeRevisionId:null,question:null,evidence:[]},i=t.processing?.status==="running",r=q("prototype",t),d=t.previewStatus==="ready",u=s.question||null,p=A||i||!!u||!r||!d;e.revisionInput.disabled=p,e.submitRevision.disabled=p,e.submitRevision.textContent=i?"Applying revision...":"Send revision",e.revisionQuestion.hidden=!u,V(e.revisionQuestionForm);const g=e.revisionQuestionForm.dataset.draftKey,o=u?Ve("clarification",u.id,u):"";if(e.revisionQuestionForm.dataset.draftKey="",e.revisionQuestionChoices.replaceChildren(),o!==g&&(e.revisionQuestionDetail.value=""),u){e.revisionQuestionTitle.textContent=u.text,e.revisionQuestionRationale.textContent=u.rationale||"",e.revisionQuestionRationale.hidden=!u.rationale;for(const w of u.choices||[]){const b=document.createElement("label");b.className="revision-question-choice";const f=document.createElement("input");f.type="radio",f.name="revision-clarification",f.value=w,f.dataset.uiKey="clarification:"+u.id+":"+w,f.checked=w===u.recommended;const h=document.createElement("span");h.textContent=w,b.append(f,h),e.revisionQuestionChoices.append(b)}const c=u.allowFreeText!==!1;e.revisionQuestionDetail.hidden=!c,e.revisionQuestionDetail.disabled=!c||A||i||!r,e.revisionQuestionDetail.placeholder=u.answerPlaceholder||"Optional clarification",e.revisionQuestionDetail.oninput=()=>{if(e.revisionQuestionDetail.value.trim())for(const w of e.revisionQuestionChoices.querySelectorAll(\'input[name="revision-clarification"]\'))w.checked=!1};for(const w of e.revisionQuestionChoices.querySelectorAll(\'input[name="revision-clarification"]\'))w.disabled=A||i||!r,w.addEventListener("change",()=>{w.checked&&(e.revisionQuestionDetail.value="")});e.submitClarification.disabled=A||i||!r,e.submitClarification.textContent=i?"Applying...":"Use this answer",Pe(e.revisionQuestionForm,o)}const l=Array.isArray(s.revisions)?s.revisions:[];e.revisionHistory.replaceChildren();for(const c of l.slice(-5).reverse()){const w=document.createElement("li"),b=document.createElement("strong");b.textContent=c.summary||c.suggestion;const f=document.createElement("span");f.textContent=c.status,w.append(b,f),e.revisionHistory.append(w)}n||(e.revisionStatus.textContent=a?r?d?i?t.status||"Applying the prototype revision...":u?"Clarify this revision before the prototype is updated.":l.length>0?"Add another revision, or finish Prototype when no changes remain.":"Try the prototype, then describe any revision you want.":"The revision box will enable when the preview is ready.":"Open the installed user-scoped Tandem to submit revisions.":"Prototype history is read only. Reopen the stage to make changes.",e.revisionStatus.dataset.status=t.processing?.status==="error"?"error":"idle")}async function Nt(t,n){if(!(D()||!q("design"))){A=!0;try{await M("/api/design-review/thread",{threadId:t,action:n})}catch(a){e.designReviewStatus.textContent=a instanceof Error?a.message:"Could not update this review thread.",e.designReviewStatus.dataset.status="error"}finally{j()}}}function sn(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="design",s=(t.lifecycle?.completedStages||[]).includes("design"),i=t.design?.substage==="test",r=(i?t.testDesignReview:t.designReview)||{threads:[],processing:null,finalizeRequested:!1,finalizedArtifactId:null},d=Array.isArray(r.threads)?r.threads:[],u=q("design",t),p=(t.artifacts||[]).find(h=>h.id===U),g=p?.stage==="design",o=i?r.finalizedArtifactId==="test-spec":["design-spec","design-review"].includes(r.finalizedArtifactId);e.productDesignSubstage.dataset.status=s?"complete":a?i?"complete":"active":"locked",e.testDesignSubstage.dataset.status=s?"complete":a&&i?"active":"locked",e.designReviewTitle.textContent=i?"Integration and interaction test design":"Product design review",e.reviewRequestKind.value==="question"&&(e.designReviewInput.placeholder=g?`Ask about ${p.title}, its tradeoffs, behavior, or risks.`:"Select a Design artifact to start a review.");const l=d.filter(h=>h.status!=="resolved"),c=d.filter(h=>["queued","processing"].includes(h.status)).length,w=d.length-l.length;if(e.reviewCount.textContent=d.length>0?"("+d.length+")":"",e.designReviewProgress.textContent=o?"Review captured from "+w+" resolved thread"+(w===1?".":"s."):w+" resolved \\xB7 "+l.length+" open"+(c>0?" \\xB7 "+c+" queued":""),e.designReviewThreads.replaceChildren(),d.length===0){const h=document.createElement("p");h.className="design-review-empty",h.textContent=!a&&!s?"Required project-specific design artifacts will be generated after Prototype.":i?"Ask about integration or interaction coverage, or generate a test scenario.":"Preparing the required project-specific design artifacts for review.",e.designReviewThreads.append(h)}for(const h of d){const x=document.createElement("article");if(x.className="review-thread",x.dataset.status=h.status,x.dataset.threadId=h.id,Tt(x,h,i),h.error){const I=document.createElement("p");I.className="review-thread-error",I.textContent=h.error,x.append(I)}const T=Array.from(new Set([...Array.isArray(h.artifactIds)?h.artifactIds:[],...h.reviewArtifactId?[h.reviewArtifactId]:[]]));if(T.length>0){const I=document.createElement("div");I.className="review-thread-artifacts";for(const m of T){const E=(t.artifacts||[]).find(B=>B.id===m);if(!E)continue;const S=document.createElement("button");S.type="button",S.className="review-artifact-link",S.dataset.threadId=h.id,S.dataset.uiKey="review-link:"+h.id+":"+m,S.textContent=E.title+(E.reviewStatus==="stale"?" \\xB7 stale":""),S.addEventListener("click",()=>{U=E.id,P(v,!0),ce("content")}),I.append(S)}x.append(I)}if(h.status==="failed"&&T.length===0&&a){const I=document.createElement("div");I.className="review-thread-actions";const m=document.createElement("button");m.type="button",m.className="thread-action",m.dataset.threadAction="retry",m.dataset.uiKey="review-retry:"+h.id,m.textContent="Retry",m.disabled=A||!u,m.addEventListener("click",()=>Nt(h.id,"retry")),I.append(m),x.append(I)}e.designReviewThreads.append(x)}const b=Ze();e.designReviewForm.hidden=!a||!g,e.finishReview.hidden=!a,e.reviewRequestKind.disabled=A||!u;const f=e.reviewRequestKind.querySelector(\'option[value="test-scenario"]\');if(f&&(f.hidden=!i),!i&&e.reviewRequestKind.value==="test-scenario"&&(e.reviewRequestKind.value="question"),e.designReviewInput.disabled=A||!u,e.reviewSubmit.disabled=A||!u,e.reviewSubmit.textContent=A?"Sending...":r.processing?b.type==="question"?"Queue question":"Queue artifact":b.label,e.finishReview.disabled=A||!u||o||!!r.processing||!!r.finalizeRequested||l.length>0,e.finishReview.textContent=o?i?"Test spec captured":"Design spec captured":r.finalizeRequested||r.processing?.action==="finalize"?"Capturing specification...":i?"Finish test design":"Finish product design",!n){const h=d.find(x=>x.status==="failed");e.designReviewStatus.textContent=a?u?h?"A review request failed. Retry it before finishing.":r.processing?"You can queue another request while this one is processing.":o?i?"The test specification is available under Artifacts \\u2192 Design.":"The design specification is available under Artifacts \\u2192 Design.":l.length>0?"Resolve each answer when it is clear.":"Ask another question or finish the review.":"Open the installed user-scoped Tandem to conduct the review.":s?"Design review is complete and remains available for reference.":"Complete Prototype to unlock review actions.",e.designReviewStatus.dataset.status=h?"error":"idle"}e.designReviewStageStatus.textContent=e.designReviewStatus.textContent,e.designReviewStageStatus.dataset.status=e.designReviewStatus.dataset.status}function rn(t){const n=new Map,a=["flowchart LR"];t.forEach((s,i)=>{const r="PlanWork"+i;n.set(s.id,r),a.push("  "+r+\'["\'+je(s.title)+"<br/>"+je(s.agentId)+\'"]\')});for(const s of t)for(const i of s.dependencies||[])n.has(i)&&a.push("  "+n.get(i)+" --> "+n.get(s.id));return a.join(`\n`)}function ye(t,n,a){t.replaceChildren();const s=Array.isArray(n)?n:[];if(s.length===0){const i=document.createElement("li");i.className="muted",i.textContent=a,t.append(i);return}for(const i of s){const r=document.createElement("li");r.textContent=i,t.append(r)}}async function on(t){const n=rn(t),a=JSON.stringify([n,document.documentElement.dataset.colorMode]);if(G.get(e.planDag)===a)return;G.set(e.planDag,a),e.planDag.dataset.diagramKey="plan:"+v?.prototypeId;const s=++He;e.planDag.replaceChildren(),Ne(e.planDag),e.planDagStatus.textContent="Rendering execution DAG...",e.planDagStatus.dataset.status="idle";try{const r=await(await et()).render("tandem-plan-"+s,n);if(s!==He)return;const d=de();e.planDag.innerHTML=r.svg,typeof r.bindFunctions=="function"&&r.bindFunctions(e.planDag),tt(e.planDag),le(d),e.planDagStatus.textContent=""}catch{if(s!==He)return;G.delete(e.planDag),e.planDagStatus.textContent="The execution DAG could not be rendered.",e.planDagStatus.dataset.status="error"}}function dn(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="plan";if(e.planTab.hidden=!me(t,"plan"),e.planTab.hidden)return;const s=t.planning||{status:"idle",summary:"",strategy:"",maxAgents:4,workItems:[],waves:[],agents:[],risks:[],metrics:{},processing:null,finalizedArtifactId:null,error:""},i=Array.isArray(s.workItems)?s.workItems:[],r=Array.isArray(s.waves)?s.waves:[],d=Array.isArray(s.agents)?s.agents:[],u=i.length>0,p=!!s.processing,g=s.finalizedArtifactId==="execution-plan"&&s.status==="complete",o=q("plan",t);!ve.get(e.planMaxAgents)&&document.activeElement!==e.planMaxAgents&&(e.planMaxAgents.value=String(s.maxAgents||4)),e.planMaxAgents.disabled=p||A||!o,e.generatePlan.disabled=p||A||!o,e.generatePlan.textContent=p?s.processing?.action==="revise"?"Revising...":"Generating...":u?"Regenerate plan":"Generate plan",e.finalizePlan.disabled=p||A||!o||!u||s.status!=="ready",e.finalizePlan.textContent=g?"Plan finalized":"Finalize plan",e.planProgress.textContent=p?"The planning agent is building an optimized execution schedule.":g?"Execution plan captured and ready for implementation.":u?i.length+" work items \\xB7 "+r.length+" parallel waves \\xB7 "+d.length+" agents":"Generate work items, schedule waves, and agent assignments.";const l=[[i.length,"Work items"],[r.length,"Parallel waves"],[d.length,"Agents"],[(s.metrics?.scheduledHours||0)+"h","Elapsed schedule"],[(s.metrics?.parallelismSavingsHours||0)+"h","Parallel time saved"]];e.planMetrics.replaceChildren();for(const[c,w]of l){const b=document.createElement("div");b.className="plan-metric";const f=document.createElement("strong");f.textContent=String(c);const h=document.createElement("span");h.textContent=w,b.append(f,h),e.planMetrics.append(b)}e.planStrategySection.hidden=!u,e.planStrategy.textContent=s.strategy||s.summary||"",e.planDagSection.hidden=!u,e.planColumns.hidden=!u,e.planRevisionSection.hidden=!u,u&&on(i),e.planWaves.replaceChildren();for(const c of r){const w=document.createElement("div");w.className="plan-wave";const b=document.createElement("div");b.className="plan-wave-heading";const f=document.createElement("strong");f.textContent="Wave "+c.index;const h=document.createElement("span");h.textContent="Hours "+c.startHour+"\\u2013"+c.endHour,b.append(f,h);const x=document.createElement("div");x.className="plan-wave-items";for(const T of c.workItemIds||[]){const I=i.find(E=>E.id===T);if(!I)continue;const m=document.createElement("span");m.className="plan-wave-item",m.textContent=I.agentId+" \\xB7 "+I.title,x.append(m)}w.append(b,x),e.planWaves.append(w)}e.planWorkItems.replaceChildren();for(const c of i){const w=document.createElement("details");w.className="plan-work-item",w.dataset.uiKey="plan-work:"+c.id;const b=document.createElement("summary");b.dataset.uiKey="plan-work:"+c.id+":summary";const f=document.createElement("span");f.className="plan-work-item-heading";const h=document.createElement("strong");h.textContent=c.title;const x=document.createElement("span");x.className="plan-work-item-meta",x.textContent=c.agentId+" \\xB7 "+c.estimatedHours+"h",f.append(h,x),b.append(f);const T=document.createElement("div");T.className="plan-work-item-body";const I=document.createElement("p");I.textContent=c.description;const m=document.createElement("p");m.className="plan-work-item-meta",m.textContent="Role: "+c.agentRole+" \\xB7 Dependencies: "+((c.dependencies||[]).join(", ")||"None")+" \\xB7 Files: "+((c.files||[]).join(", ")||"Owned scope TBD");const E=document.createElement("strong");E.textContent="Acceptance criteria";const S=document.createElement("ul");ye(S,c.acceptanceCriteria,"None recorded");const B=document.createElement("strong");B.textContent="Validation";const y=document.createElement("ul");ye(y,c.validation,"None recorded"),T.append(I,m,E,S,B,y),w.append(b,T),e.planWorkItems.append(w)}e.planAgents.replaceChildren();for(const c of d){const w=document.createElement("div");w.className="plan-agent";const b=document.createElement("strong");b.textContent=c.id;const f=document.createElement("span");f.className="plan-agent-meta",f.textContent=c.estimatedHours+"h \\xB7 "+(c.roles||[]).join(", ")+" \\xB7 "+(c.workItemIds||[]).length+" items",w.append(b,f),e.planAgents.append(w)}ye(e.planRisks,s.risks,"No additional planning risks recorded."),e.planRevisionInput.disabled=p||A||!o,e.optimizePlan.disabled=p||A||!o,e.revisePlan.disabled=p||A||!o,e.revisePlan.textContent=p?"Revising...":"Revise plan",n||(e.planStatus.textContent=a?o?s.error?s.error:p?"Planning continues asynchronously.":g?"The final execution plan is available under Artifacts \\u2192 Plan.":u?"Review the schedule, revise it, then finalize the plan.":"Set the agent limit and generate the initial plan.":"Open the installed user-scoped Tandem to generate the plan.":"Execution plan is read only. Reopen Plan to change it.",e.planStatus.dataset.status=s.status==="failed"||s.error?"error":"idle")}function Dt(t,n){if(!t)return"0m";const a=Date.parse(t),s=n?Date.parse(n):Date.now();if(!Number.isFinite(a)||!Number.isFinite(s))return"0m";const i=Math.max(0,Math.round((s-a)/6e4));return i<60?i+"m":Math.floor(i/60)+"h "+i%60+"m"}function $(t,n){const a=document.createElement("p");a.className="muted",a.textContent=n,t.append(a)}function Pt(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="implement";if(e.implementationTab.hidden=!me(t,"implement"),e.implementationTab.hidden)return;const s=t.planning||{workItems:[],waves:[]},i=t.implementation||{status:"idle",currentWaveIndex:0,workItems:[],agents:[],strategySuggestions:[],events:[],error:""},r=t.implementationRuntime||null,d=Array.isArray(s.workItems)?s.workItems:[],u=Array.isArray(i.workItems)?i.workItems:[],p=new Map(u.map(m=>[m.id,m])),g=u.filter(m=>m.status==="completed").length,o=u.filter(m=>m.status==="running").length,l=u.filter(m=>["failed","blocked","cancelled"].includes(m.status)).length,c=["starting","running"].includes(i.status),w=q("implement",t),b=u.length>0?Math.round(g/u.length*100):0;e.implementationProgress.textContent=c?"Wave "+(i.currentWaveIndex||1)+" is active \\xB7 "+(r?.liveAgentCount??o)+" live agents":i.status==="completed"?"All planned work completed and final code was captured.":l>0?"Review failures, adjust strategy, and retry incomplete work.":"Ready to assign the finalized work items.",e.implementationProgressLabel.textContent=g+" of "+u.length+" complete \\xB7 "+b+"%",e.implementationProgressBar.style.width=b+"%",e.startImplementation.disabled=H||c||!w||i.status==="completed"||d.length===0,e.startImplementation.textContent=i.status==="failed"||i.status==="cancelled"?"Retry incomplete work":i.status==="completed"?"Implementation complete":c?"Agents running...":"Start implementation",e.stopImplementation.hidden=!c,e.stopImplementation.disabled=H||!w,e.implementationStrategyInput.disabled=H||!w||i.status==="completed",e.submitImplementationStrategy.disabled=H||!w||i.status==="completed",e.submitImplementationStrategy.textContent=H?"Queueing...":"Queue adjustment";const f=[[g+"/"+u.length,"Completed"],[r?.liveAgentCount??o,"Live agents"],[i.currentWaveIndex||0,"Current wave"],[l,"Needs attention"],[Dt(i.startedAt,i.completedAt),"Elapsed"]];e.implementationMetrics.replaceChildren();for(const[m,E]of f){const S=document.createElement("div");S.className="plan-metric";const B=document.createElement("strong");B.textContent=String(m);const y=document.createElement("span");y.textContent=E,S.append(B,y),e.implementationMetrics.append(S)}e.implementationWaves.replaceChildren();for(const m of s.waves||[]){const E=(m.workItemIds||[]).map(C=>p.get(C)?.status||"pending"),S=E.length>0&&E.every(C=>C==="completed")?"completed":E.some(C=>C==="running")?"running":E.some(C=>["failed","blocked","cancelled"].includes(C))?"failed":"pending",B=document.createElement("div");B.className="implementation-card",B.dataset.status=S;const y=document.createElement("div");y.className="implementation-card-heading";const R=document.createElement("strong");R.textContent="Wave "+m.index;const k=document.createElement("span");k.className="implementation-badge",k.textContent=S,y.append(R,k);const N=document.createElement("p");N.className="implementation-meta",N.textContent=(m.workItemIds||[]).map(C=>d.find(F=>F.id===C)?.title||C).join(" \\xB7 "),B.append(y,N),e.implementationWaves.append(B)}(s.waves||[]).length||$(e.implementationWaves,"No execution waves are available."),e.implementationWorkItems.replaceChildren();for(const m of d){const E=p.get(m.id)||{status:"pending",summary:"",filesChanged:[],validation:[],blockers:[]},S=document.createElement("details");S.className="implementation-card",S.dataset.uiKey="implementation-work:"+m.id,S.dataset.status=E.status,["running","failed","blocked"].includes(E.status)&&(S.open=!0);const B=document.createElement("summary");B.dataset.uiKey="implementation-work:"+m.id+":summary",B.className="implementation-card-heading";const y=document.createElement("strong");y.textContent=m.title;const R=document.createElement("span");R.className="implementation-badge",R.textContent=E.status,B.append(y,R);const k=document.createElement("div"),N=document.createElement("p");if(N.className="implementation-meta",N.textContent=m.agentId+" \\xB7 "+m.agentRole+" \\xB7 dependencies: "+((m.dependencies||[]).join(", ")||"none"),k.append(N),E.summary){const C=document.createElement("p");C.textContent=E.summary,k.append(C)}if((E.filesChanged||[]).length>0){const C=document.createElement("p");C.className="implementation-meta",C.textContent="Files: "+E.filesChanged.join(", "),k.append(C)}if((E.validation||[]).length>0){const C=document.createElement("p");C.className="implementation-meta",C.textContent="Validation: "+E.validation.join(" \\xB7 "),k.append(C)}if((E.blockers||[]).length>0){const C=document.createElement("p");C.textContent="Blocked: "+E.blockers.join(" \\xB7 "),k.append(C)}S.append(B,k),e.implementationWorkItems.append(S)}const h=new Map((r?.agents||[]).map(m=>[String(m.label||"").replace(/^work:/,""),m])),x=new Map((i.agents||[]).map(m=>[m.workItemId,m])),T=new Set([...x.keys(),...h.keys()]);e.implementationAgents.replaceChildren();for(const m of T){const E=x.get(m)||{},S=h.get(m)||{},B=d.find(J=>J.id===m),y=S.status||E.status||"pending",R=document.createElement("div");R.className="implementation-card",R.dataset.status=y;const k=document.createElement("div");k.className="implementation-card-heading";const N=document.createElement("strong");N.textContent=B?.agentId||E.id||"Implementation agent";const C=document.createElement("span");C.className="implementation-badge",C.textContent=y,k.append(N,C);const K=document.createElement("p");K.className="implementation-meta",K.textContent=(B?.agentRole||E.role||"Implementation")+" \\xB7 "+(B?.title||m)+(S.model?" \\xB7 "+S.model:"")+(S.activeMs?" \\xB7 "+Math.round(S.activeMs/1e3)+"s active":"");const F=document.createElement("p");F.textContent=S.activity||E.activity||E.summary||"Waiting for activity.",R.append(k,K,F),e.implementationAgents.append(R)}T.size===0&&$(e.implementationAgents,"Agents appear here after implementation starts."),e.implementationStrategies.replaceChildren();for(const m of[...i.strategySuggestions||[]].reverse()){const E=document.createElement("div");E.className="implementation-strategy";const S=document.createElement("div");S.className="implementation-card-heading";const B=document.createElement("span");B.className="implementation-badge",B.textContent=m.status;const y=document.createElement("span");y.className="implementation-meta",y.textContent=m.waveIndex?"Applied to wave "+m.waveIndex:"Applies at the next wave boundary",S.append(B,y);const R=document.createElement("p");R.textContent=m.text,E.append(S,R),e.implementationStrategies.append(E)}const I=[...(i.events||[]).map(m=>({id:m.id,text:m.message,at:Date.parse(m.at)||0})),...(r?.progress||[]).map(m=>({id:"runtime-"+m.seq,text:m.text,at:Number(m.recordedAt)||0}))].sort((m,E)=>E.at-m.at).slice(0,20);e.implementationEvents.replaceChildren();for(const m of I){const E=document.createElement("div");E.className="implementation-event";const S=document.createElement("div");S.className="implementation-event-heading";const B=document.createElement("p");B.textContent=m.text;const y=document.createElement("time");y.textContent=m.at?new Date(m.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"",S.append(B,y),E.append(S),e.implementationEvents.append(E)}I.length===0&&$(e.implementationEvents,"Run events and factory progress appear here."),n||(e.implementationStatus.textContent=a?w?r?.error?"Live agent details are unavailable: "+r.error:i.error?i.error:c?"Suggestions are queued immediately and applied before the next wave.":i.status==="completed"?"Final code is available under Artifacts \\u2192 Implement.":l>0?"Retry preserves completed work and reruns only incomplete items.":"Start the agents when the execution plan is ready.":"Open the installed user-scoped Tandem to run implementation.":"Implementation evidence is read only.",e.implementationStatus.dataset.status=i.status==="failed"||i.error||r?.error?"error":"idle")}function Lt(t,n=!1){const a=(t.lifecycle?.currentStage||"requirements")==="test";if(e.testTab.hidden=!me(t,"test"),e.testTab.hidden)return;const s=Array.isArray(t.testDesignReview?.scenarios)?t.testDesignReview.scenarios:[],i=t.testing||{status:"idle",currentWaveIndex:0,scenarios:[],agents:[],events:[],error:""},r=t.testRuntime||null,d=Array.isArray(i.scenarios)?i.scenarios:[],u=new Map(d.map(y=>[y.id,y])),p=d.filter(y=>y.status==="passed").length,g=d.filter(y=>y.status==="running").length,o=d.filter(y=>["failed","blocked"].includes(y.status)).length,l=["starting","running"].includes(i.status),c=i.status==="completed",w=q("test",t,!0),b=d.length>0?Math.round(p/d.length*100):0;e.testProgress.textContent=l?"Wave "+(i.currentWaveIndex||1)+" is active \\xB7 "+(r?.liveAgentCount??g)+" live agents":c?"All approved scenarios passed and test evidence was captured.":o>0?"Review failed or blocked scenarios, then retry incomplete tests.":"Ready to execute the approved test specification.",e.testProgressLabel.textContent=p+" of "+d.length+" passed \\xB7 "+b+"%",e.testProgressBar.style.width=b+"%",e.startTests.disabled=D()||l||!w||s.length===0||ie(t),e.startTests.textContent=c?"Run tests again":l?"Tests running...":o>0?"Retry incomplete tests":"Run tests";const f=[[p+"/"+d.length,"Passed"],[r?.liveAgentCount??g,"Live agents"],[i.currentWaveIndex||0,"Current wave"],[o,"Needs attention"],[Dt(i.startedAt,i.completedAt),"Elapsed"]];e.testMetrics.replaceChildren();for(const[y,R]of f){const k=document.createElement("div");k.className="plan-metric";const N=document.createElement("strong");N.textContent=String(y);const C=document.createElement("span");C.textContent=R,k.append(N,C),e.testMetrics.append(k)}e.testScenarios.replaceChildren();for(const y of s){const R=u.get(y.id)||{status:"pending",summary:"",evidence:[]},k=document.createElement("details");k.className="implementation-card",k.dataset.uiKey="test-scenario:"+y.id,k.dataset.status=R.status,["running","failed","blocked"].includes(R.status)&&(k.open=!0);const N=document.createElement("summary");N.dataset.uiKey="test-scenario:"+y.id+":summary",N.className="implementation-card-heading";const C=document.createElement("strong");C.textContent=y.title;const K=document.createElement("span");K.className="implementation-badge",K.textContent=R.status,N.append(C,K);const F=document.createElement("div"),J=document.createElement("p");if(J.className="implementation-meta",J.textContent=String(y.type||"integration")+" \\xB7 dependencies: "+((y.dependencies||[]).join(", ")||"none"),F.append(J),y.description){const W=document.createElement("p");W.textContent=y.description,F.append(W)}if(R.summary){const W=document.createElement("p");W.textContent=R.summary,F.append(W)}if((R.evidence||[]).length>0){const W=document.createElement("strong");W.textContent="Evidence";const se=document.createElement("ul");ye(se,R.evidence,"No evidence captured."),F.append(W,se)}k.append(N,F),e.testScenarios.append(k)}s.length===0&&$(e.testScenarios,"Finalize Test design to create executable scenarios.");const h=new Map((r?.agents||[]).map(y=>[String(y.label||"").replace(/^test:/,""),y])),x=new Map((i.agents||[]).map(y=>[y.scenarioId,y])),T=new Set([...x.keys(),...h.keys()]);e.testAgents.replaceChildren();for(const y of T){const R=x.get(y)||{},k=h.get(y)||{},N=s.find(Ft=>Ft.id===y),C=k.status||R.status||"pending",K=document.createElement("div");K.className="implementation-card",K.dataset.status=C;const F=document.createElement("div");F.className="implementation-card-heading";const J=document.createElement("strong");J.textContent=R.id||"Test agent";const W=document.createElement("span");W.className="implementation-badge",W.textContent=C,F.append(J,W);const se=document.createElement("p");se.className="implementation-meta",se.textContent=(N?.type||"integration")+" \\xB7 "+(N?.title||y)+(k.model?" \\xB7 "+k.model:"")+(k.activeMs?" \\xB7 "+Math.round(k.activeMs/1e3)+"s active":"");const it=document.createElement("p");it.textContent=k.activity||R.activity||R.summary||"Waiting for activity.",K.append(F,se,it),e.testAgents.append(K)}T.size===0&&$(e.testAgents,"Agents appear here after test execution starts.");const I=[...(i.events||[]).map(y=>({id:y.id,text:y.message,at:Date.parse(y.at)||0})),...(r?.progress||[]).map(y=>({id:"runtime-"+y.seq,text:y.text,at:Number(y.recordedAt)||0}))].sort((y,R)=>R.at-y.at).slice(0,20);e.testEvents.replaceChildren();for(const y of I){const R=document.createElement("div");R.className="implementation-event";const k=document.createElement("div");k.className="implementation-event-heading";const N=document.createElement("p");N.textContent=y.text;const C=document.createElement("time");C.textContent=y.at?new Date(y.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"",k.append(N,C),R.append(k),e.testEvents.append(R)}I.length===0&&$(e.testEvents,"Test events and factory progress appear here.");const m=d.filter(y=>["failed","blocked"].includes(y.status)),E=i.errorDetails||JSON.stringify({summary:i.error||r?.error||"Test execution failed.",run:{id:i.runId||r?.runId||"unavailable",status:i.status||r?.status||"failed"},failedScenarios:m.map(y=>({id:y.id,status:y.status,summary:y.summary,evidence:y.evidence||[]})),failedAgents:(i.agents||[]).filter(y=>["failed","blocked"].includes(y.status)).map(y=>({id:y.id,scenarioId:y.scenarioId,status:y.status,activity:y.activity,summary:y.summary})),errorEvents:(i.events||[]).filter(y=>y.type==="error")},null,2),S=!!(i.status==="failed"||i.error||r?.error||m.length>0),B=S?[i.requestId||i.runId||r?.runId||"legacy",i.startedAt].join("|"):"";B!==ut&&(ut=B,O=!1),e.testErrorToggle.hidden=!S,e.testErrorToggle.textContent=O?"Hide error details":"Show error details",e.testErrorToggle.setAttribute("aria-expanded",String(O)),e.testErrorDetails.hidden=!S||!O,e.testErrorDetails.textContent=S?E:"",n||(e.testStatus.textContent=a?w?r?.error?"Live agent details are unavailable: "+r.error:i.error?i.error:l?"Independent scenarios run concurrently within each dependency wave.":c?"Test results are available under Artifacts \\u2192 Test.":o>0?"Retry preserves passes only when source and specification are unchanged; otherwise all scenarios run again.":"Run the approved integration and interaction scenarios.":"Open the installed user-scoped Tandem to run tests.":"Test evidence is read only.",e.testStatus.dataset.status=i.status==="failed"||i.error||r?.error?"error":"idle")}function ln(t,n=!1){const a=ue(t),s=t.previewStatus||"waiting",i=!!Q(t,"prototype"),r=Q(t,"prototype")?.reason||"No graphical interface needs prototype validation.",d=t.prototypeApproach?.mode==="validate-existing",u=t.prototypeApproach?.mode==="undecided",p=t.processing?.action==="build-prototype"?t.processing:null,g=!i&&!u&&a==="prototype"&&(s==="starting"||p?.status==="running");if(e.previewTab.disabled=i,e.previewTab.title=i?r:"",i&&L==="preview"&&(L=De(a==="prototype"?"requirements":a)),e.previewStatus.textContent=i?"not applicable":g?"building":s,e.previewTab.classList.toggle("prototype-building-tab",g),e.previewTab.setAttribute("aria-label",i?"Live prototype, not applicable. "+r:g?d?"Live prototype, validating existing app":"Live prototype, building":"Live prototype"),e.prototypeBuildingTitle.textContent=d?"Validating existing prototype":"Building runnable prototype",e.prototypeBuilding.hidden=!g,Ie!==null&&(window.clearInterval(Ie),Ie=null),g){e.prototypeBuildingMessage.textContent=p?.message||t.status||(d?"Existing prototype validation is running.":"Prototype build is running.");const l=()=>{e.prototypeBuildingElapsed.textContent=bt(p?.requestedAt)};l(),Ie=window.setInterval(l,1e3)}else e.prototypeBuildingElapsed.textContent="";e.startPrototype.hidden=i||g||s==="ready"||a!=="prototype",e.startPrototype.disabled=D()||!q("prototype",t)||ie(t),e.startPrototype.textContent=ne?"Requesting...":d?s==="error"?"Retry existing prototype validation":"Validate existing prototype":s==="error"?"Retry prototype build":"Start prototype",e.previewEmptyMessage.textContent=i?"Live prototype is not applicable. "+r:u?"Choose the prototype approach in Requirements before starting prototype work.":s==="error"?"Prototype "+(d?"validation":"build")+" failed. Review the error, then retry.":a==="prototype"?d?"No prototype validation is running. Validate the existing app without replacing it.":"No prototype build is running. Start a build to create the runnable preview.":"The runnable prototype will appear after Requirements are completed.",n||(e.prototypeBuildStatus.textContent=s==="error"?p?.message||t.status||"The preview is unavailable.":"",e.prototypeBuildStatus.dataset.status=s==="error"?"error":"idle");const o=t.previewUrl;if(i||u||!o||g||s!=="ready"){e.previewEmpty.style.display=g?"none":"grid",e.previewFrame.style.display="none",e.openPreview.style.display="none";return}e.previewEmpty.style.display="none",e.previewFrame.style.display="block",e.openPreview.style.display="inline",e.openPreview.href=o,e.previewFrame.dataset.url!==o&&(e.previewFrame.dataset.url=o,e.previewFrame.src=o)}function cn(){for(const t of document.querySelectorAll(".next-action-target, .next-action-tab")){t.classList.remove("next-action-target","next-action-tab"),t.removeAttribute("data-next-action-label"),t.removeAttribute("aria-describedby");const n=t.dataset.originalTitle;n?t.setAttribute("title",n):t.removeAttribute("title"),delete t.dataset.originalTitle}}function un(t){if(_||A||Z||H||oe||Z||ne||Y||t.provider?.canSubmitAnswers===!1)return null;const n=t.lifecycle?.currentStage||"prepare";if(n==="prepare")return t.preparation?.status==="failed"&&!e.retryPreparation.disabled?{tab:"preparation",target:e.retryPreparation,label:"Retry preparation"}:null;if(n==="requirements")return t.processing?.status==="running"?null:t.requirements?.substage!=="dag"?(t.requirements?.usageItems||[]).length>0?{tab:"design-tree",target:e.generateDag,label:"Generate the requirements DAG"}:{tab:"design-tree",target:e.addUsage,label:"Add the first usage"}:(t.decisionGraph?.nodes||[]).some(a=>a.status==="active")?{tab:"design-tree",target:e.questionHost.querySelector(".send"),label:"Answer the active requirement decision"}:e.completeStage.disabled?null:{target:e.completeStage,label:"Finish requirements collection"};if(n==="prototype")return t.processing?.status==="running"?null:t.previewStatus!=="ready"&&!e.startPrototype.disabled?{tab:"preview",target:e.startPrototype,label:t.prototypeApproach?.mode==="validate-existing"?"Validate the existing prototype":t.previewStatus==="error"?"Retry the prototype build":"Start the prototype build"}:t.prototypeReview?.question?{tab:"preview",target:e.submitClarification,label:"Answer the prototype clarification"}:e.completeStage.disabled?null:{target:e.completeStage,label:"Finish prototype iteration"};if(n==="design"){const a=t.design?.substage==="test"?t.testDesignReview:t.designReview;if(a?.processing||a?.finalizeRequested)return null;const s=document.querySelector(\'[data-thread-action="retry"]\');if(s)return{tab:s.closest("#artifact-review")?"content":"design-review",target:s,label:"Retry the failed design review request"};const i=e.artifactReviewThreads.querySelector(\'[data-thread-action="resolve"]\');if(i)return{tab:"content",target:i,label:"Mark the answered design thread resolved"};const r=(a?.threads||[]).find(d=>["answered","failed"].includes(d.status));if(r){const d=Array.from(e.designReviewThreads.querySelectorAll(".review-artifact-link")).find(u=>u.dataset.threadId===r.id);if(d)return{tab:"design-review",target:d,label:"Open the design artifact for review"}}return e.finishReview.disabled?e.completeStage.disabled?null:{target:e.completeStage,label:"Finish the Design stage"}:{tab:"design-review",target:e.finishReview,label:t.design?.substage==="test"?"Finish integration and interaction test design":"Finish product design"}}if(n==="plan"){if(t.planning?.processing)return null;if(!e.completeStage.disabled)return{target:e.completeStage,label:"Finish execution planning"};const a=(t.planning?.workItems||[]).length>0;return a&&!e.finalizePlan.disabled?{tab:"plan",target:e.finalizePlan,label:"Finalize the execution plan"}:e.generatePlan.disabled?null:{tab:"plan",target:e.generatePlan,label:a?"Regenerate the execution plan":"Generate the execution plan"}}if(n==="implement")return["starting","running"].includes(t.implementation?.status)?null:e.completeStage.disabled?e.startImplementation.disabled?null:{tab:"implementation",target:e.startImplementation,label:["failed","cancelled"].includes(t.implementation?.status)?"Retry incomplete implementation work":"Start implementation"}:{target:e.completeStage,label:"Finish implementation"};if(n==="test"){if(["starting","running"].includes(t.testing?.status))return null;if(!e.completeStage.disabled)return{target:e.completeStage,label:"Finish integration testing"};if(!e.startTests.disabled)return{tab:"test",target:e.startTests,label:(t.testing?.scenarios||[]).some(a=>["failed","blocked"].includes(a.status))?"Retry incomplete integration tests":"Run integration and interaction tests"}}return null}function he(t){cn();const n=un(t);if(!n?.target||n.target.disabled){Re&&(e.nextActionGuide.textContent="",Re="");return}if(n.target.classList.add("next-action-target"),n.target.dataset.nextActionLabel="Next",n.target.dataset.originalTitle=n.target.title||"",n.target.title="Next action: "+n.label,n.target.setAttribute("aria-describedby","next-action-guide"),n.label!==Re&&(e.nextActionGuide.textContent="Next action: "+n.label,Re=n.label),n.tab&&n.tab!==L){const a=e.previewTabs.find(s=>s.dataset.tab===n.tab);a&&!a.hidden&&(a.classList.add("next-action-tab"),a.dataset.nextActionLabel="Next",a.title="Open this tab for the next action: "+n.label,a.setAttribute("aria-describedby","next-action-guide"))}}function P(t,n=!1){const a=de();v=t;const s=t.lifecycle?.currentStage||"prepare";s!==Se&&((!Se||ae===Se)&&(L=De(s),ae=s),Se=s),$t(t,n),Rt(t,n),At(t,n),e.phase.textContent=t.phase||"discovery",e.goal.textContent=t.goal||"Waiting for a prototype goal...",e.goal.classList.toggle("muted",!t.goal),e.status.textContent=t.status||"",Ke(e.confirmed,t.confirmed),Ke(e.assumed,t.assumed),Ke(e.deferred,t.deferred),tn(t.artifacts),Yt(t),ln(t,n),an(t,n),sn(t,n),dn(t,n),Pt(t,n),Lt(t,n),It(t),ce(L),le(a),nt(t)}function Mt(t){return t&&typeof t=="object"&&typeof t.prototypeId=="string"&&z.some(n=>n.id===t.lifecycle?.currentStage)&&(t.revision===void 0||Number.isSafeInteger(t.revision)&&t.revision>=0)}function at(t,n=++Ue){if(!Mt(t))throw new Error("The studio returned an invalid state.");const a=t.revision??0,s=v?.revision??0;if(v&&(t.prototypeId!==v.prototypeId||a<s||a===0&&s===0&&Date.parse(t.updatedAt)<Date.parse(v.updatedAt)))return!1;const i=!v||a>s||a===0&&t.updatedAt!==v.updatedAt,r=i?{...t,revision:a}:{...v};for(const b of["provider","preparationRuntime","implementationRuntime","testRuntime"])n>=Fe&&Object.hasOwn(t,b)?r[b]=t[b]:v&&Object.hasOwn(v,b)&&(r[b]=v[b]);Fe=Math.max(Fe,n);const d=JSON.stringify(r.provider||null),u=JSON.stringify(r.preparationRuntime||null),p=JSON.stringify(r.implementationRuntime||null),g=JSON.stringify(r.testRuntime||null),o=d!==ct,l=u!==dt,c=p!==lt,w=g!==mt;if(ct=d,dt=u,lt=p,mt=g,v=r,i||o)P(r);else if(l||c||w){const b=de();l&&Rt(r),c&&Pt(r),w&&Lt(r),le(b)}return i||o||l||c||w}function Le(t=0){if(re)return pt<=t?re.catch(()=>{}).then(()=>Le(t)):re;const n=++Ue;pt=n;const a=(v?.lifecycle?.currentStage||"")==="prepare"?"/api/preparation/status":(v?.lifecycle?.currentStage||"")==="implement"?"/api/implementation/status":(v?.lifecycle?.currentStage||"")==="test"?"/api/test/status":"/api/state";return re=fetch(a,{cache:"no-store",signal:AbortSignal.timeout(15e3)}).then(async s=>{if(!s.ok)throw new Error("Could not load studio state.");const i=await s.json();at(i,n),e.connectionStatus.textContent=""}).catch(s=>{throw e.connectionStatus.textContent="Connection interrupted. Retrying...",s}).finally(()=>{re=null}),re}Le().catch(()=>{e.connectionStatus.textContent="Could not load the studio state. Retrying..."});setInterval(()=>Le().catch(()=>{}),2e3);const Ht=new EventSource("/events");Ht.onmessage=t=>{try{at(JSON.parse(t.data)),e.connectionStatus.textContent=""}catch{e.connectionStatus.textContent="Could not read the studio update. Retrying..."}};Ht.onerror=()=>{e.connectionStatus.textContent="Reconnecting to the studio..."};new MutationObserver(()=>{fe=null,v&&P(v,!0)}).observe(document.documentElement,{attributes:!0,attributeFilter:["data-color-mode"]});})();\n';

// tandem-styles:styles.css
var styles_default = ':root{color-scheme:light dark;font-family:var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);font-size:var(--text-body-medium, 14px);line-height:var(--leading-body-medium, 20px);background:var(--background-color-default, #fff);color:var(--text-color-default, #1f2328);--studio-accent: var(--text-color-muted, #526f8a);--studio-accent: color-mix( in srgb, var(--true-color-blue, #0969da) 58%, var(--text-color-muted, #656d76) );--studio-accent-strong: var(--text-color-default, #3f5f7d);--studio-accent-strong: color-mix( in srgb, var(--studio-accent) 78%, var(--text-color-default, #1f2328) );--studio-accent-soft: var(--background-color-muted, #eef3f7);--studio-accent-soft: color-mix( in srgb, var(--background-color-default, #fff) 90%, var(--studio-accent) );--studio-panel: var(--background-color-default, #f8fafc);--studio-panel: color-mix( in srgb, var(--background-color-default, #fff) 97%, var(--studio-accent) );--studio-section: var(--background-color-muted, #f4f7fa);--studio-section: color-mix( in srgb, var(--background-color-default, #fff) 94%, var(--studio-accent) );--studio-border: var(--border-color-default, #c8d2dc);--studio-border: color-mix( in srgb, var(--border-color-default, #d0d7de) 78%, var(--studio-accent) );--studio-mark: #3f6582;--studio-mark: color-mix( in srgb, var(--true-color-blue, #0969da) 58%, #475569 );--studio-header: #edf3f8;--studio-header: color-mix( in srgb, var(--background-color-default, #fff) 89%, var(--studio-accent) );--studio-sidebar: #f3f7fa;--studio-sidebar: color-mix( in srgb, var(--background-color-default, #fff) 94%, var(--studio-accent) );--studio-card: var(--background-color-default, #fff);--studio-card: color-mix( in srgb, var(--background-color-default, #fff) 98%, var(--studio-accent) );--next-action-color: #d4a72c}*{box-sizing:border-box}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);white-space:nowrap}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:var(--studio-panel);color:var(--text-color-default, #1f2328)}body.is-resizing{cursor:col-resize;user-select:none}body.is-resizing iframe{pointer-events:none}button,input,textarea,select{font:inherit;color:inherit}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--color-focus-outline, #0969da);outline-offset:2px}.next-action-target{position:relative;z-index:1;box-shadow:0 0 0 2px var(--background-color-default, #fff),0 0 0 4px var(--next-action-color);animation:next-action-target-pulse 1.8s ease-in-out infinite}.next-action-target:after{display:grid;position:absolute;z-index:2;top:-12px;right:-10px;place-items:center;width:21px;height:21px;border:2px solid var(--background-color-default, #fff);border-radius:50%;background:var(--next-action-color);color:var(--color-white, #fff);content:"\\2192";font-size:13px;font-weight:var(--font-weight-bold, 700);line-height:1;pointer-events:none}.app{display:grid;grid-template-rows:auto minmax(0,1fr);height:100%}.topbar{display:flex;align-items:center;gap:14px;min-height:60px;padding:10px 16px;border-bottom:1px solid var(--studio-accent);background:var(--studio-header);box-shadow:inset 3px 0 0 var(--studio-accent),inset 0 -2px color-mix(in srgb,var(--studio-accent) 22%,transparent)}.brand{display:flex;align-items:center;gap:10px;min-width:0}.brand-copy{min-width:0}.mark{display:grid;place-items:center;width:36px;height:36px;flex:0 0 auto;border:1px solid color-mix(in srgb,var(--studio-mark) 80%,#000);border-radius:10px 4px;background:var(--studio-mark);color:var(--color-white, #fff);font-weight:var(--font-weight-semibold, 600);letter-spacing:.06em;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--color-white, #fff) 18%,transparent),0 2px 5px color-mix(in srgb,var(--studio-mark) 24%,transparent)}.brand-subtitle{display:block;margin-top:1px;color:var(--text-color-muted, #656d76);font-size:11px;line-height:14px;letter-spacing:.04em;text-transform:uppercase}h1{margin:0;font-size:var(--text-title-medium, 18px);line-height:var(--leading-title-medium, 24px);font-weight:var(--font-weight-semibold, 600);letter-spacing:-.01em}.topbar-actions{margin-left:auto;display:flex;align-items:center;gap:12px}.build-version{flex:0 0 auto;color:var(--text-color-muted, #656d76);font-family:var(--font-mono, ui-monospace, "SFMono-Regular", Consolas, monospace);font-size:var(--text-body-small, 12px);white-space:nowrap}.lifecycle{display:flex;align-items:center;gap:6px}.stage{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 4px;border:1px solid var(--studio-mark);border-radius:999px;background:var(--studio-mark);color:var(--color-white, #fff);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600);text-transform:capitalize;box-shadow:0 1px 3px color-mix(in srgb,var(--studio-mark) 20%,transparent)}.stage-index{display:grid;place-items:center;width:18px;height:18px;border:1px solid color-mix(in srgb,var(--color-white, #fff) 42%,transparent);border-radius:50%;background:color-mix(in srgb,var(--color-white, #fff) 14%,transparent);color:var(--color-white, #fff);font-size:11px}.reload-control{display:flex;align-items:center;gap:7px;min-width:0}.reload-button{min-height:28px;padding:3px 9px;border:1px solid var(--studio-border);border-radius:4px;background:var(--background-color-default, #fff);color:var(--text-color-default, #1f2328);white-space:nowrap;cursor:pointer}.reload-button:hover:not(:disabled){border-color:var(--studio-accent);background:var(--studio-accent-soft)}.reload-button:disabled{cursor:not-allowed;opacity:.6}.reload-status{max-width:190px;overflow:hidden;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-overflow:ellipsis;white-space:nowrap}.reload-status[data-status=success]{color:var(--studio-accent-strong)}.reload-status[data-status=error]{color:var(--true-color-red, #cf222e)}.phase{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:1px solid var(--studio-border);border-radius:999px;background:var(--background-color-default, #fff);color:var(--studio-accent-strong);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600);text-transform:capitalize}.phase:before{width:6px;height:6px;border-radius:50%;background:var(--studio-accent);content:""}.workspace{--requirements-width: 24%;display:grid;grid-template-columns:minmax(280px,var(--requirements-width)) 9px minmax(360px,1fr);min-height:0}.requirements{min-width:0;overflow:auto;padding:16px;background:var(--studio-sidebar);box-shadow:inset 3px 0 0 var(--studio-accent)}.splitter{position:relative;z-index:2;width:9px;min-width:9px;padding:0;border:0;outline:0;background:transparent;cursor:col-resize;touch-action:none}.splitter:before{position:absolute;inset:0 auto 0 50%;width:1px;content:"";background:var(--studio-border);transform:translate(-50%);transition:width .1s ease,background-color .1s ease}.splitter:hover:before,.splitter:focus-visible:before,.splitter.is-dragging:before{width:3px;background:var(--studio-accent)}.splitter:focus-visible{outline:2px solid var(--color-focus-outline, #0969da);outline-offset:-2px}.preview{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;background:var(--background-color-muted, #f6f8fa);container:output / inline-size}.previewbar{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border-bottom:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff);flex-wrap:wrap}.preview-tabs{display:flex;align-self:stretch;gap:4px;min-width:0;flex-wrap:wrap}.preview-tab{position:relative;min-height:43px;padding:0 8px;border:0;background:transparent;color:var(--text-color-muted, #656d76);cursor:pointer}.preview-tab:after{position:absolute;right:8px;bottom:-1px;left:8px;height:2px;border-radius:2px 2px 0 0;background:transparent;content:""}.preview-tab:hover{color:var(--text-color-default, #1f2328)}.preview-tab:disabled{color:var(--text-color-muted, #656d76);cursor:not-allowed;opacity:.55}.preview-tab[aria-selected=true]{color:var(--text-color-default, #1f2328);font-weight:var(--font-weight-semibold, 600)}.preview-tab[aria-selected=true]:after{background:var(--color-focus-outline, #0969da)}.preview-tab.next-action-tab:not([aria-selected=true]){color:var(--next-action-color);font-weight:var(--font-weight-semibold, 600)}.preview-tab.next-action-tab:not([aria-selected=true]):before{display:grid;position:absolute;top:3px;right:-2px;place-items:center;width:16px;height:16px;border:2px solid var(--background-color-default, #fff);border-radius:50%;background:var(--next-action-color);color:var(--color-white, #fff);content:"\\2192";font-size:9px;font-weight:var(--font-weight-bold, 700);line-height:1;animation:next-action-beacon 1.8s ease-out infinite}.preview-tab.prototype-building-tab:before{position:absolute;top:7px;right:-1px;width:10px;height:10px;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 18%,var(--studio-accent) 42%,var(--studio-accent-strong) 100%);-webkit-mask:radial-gradient(circle,transparent 42%,#000 47%);mask:radial-gradient(circle,transparent 42%,#000 47%);content:"";animation:processing-spin .9s linear infinite}.artifact-count{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-normal, 400)}.preview-tools{display:flex;align-items:center;gap:10px;margin-left:auto}.preview-status{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.open-preview{display:none;color:var(--text-color-default, #1f2328);font-size:var(--text-body-small, 12px)}[hidden]{display:none!important}.frame-wrap{display:grid;grid-template-rows:minmax(300px,1fr) auto;gap:12px;min-height:0;overflow:auto;padding:12px}.preview-surface{position:relative;min-height:300px}.prototype-building{display:grid;height:100%;min-height:260px;padding:24px;place-items:center;border:1px dashed var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.prototype-building-card{display:flex;align-items:flex-start;width:min(460px,100%);gap:12px;padding:16px;border:1px solid var(--studio-border);border-radius:8px;background:var(--studio-accent-soft);box-shadow:0 8px 28px color-mix(in srgb,var(--studio-accent) 10%,transparent)}.prototype-building-card .processing-indicator{width:22px;height:22px}#preview-frame{display:none;width:100%;height:100%;border:1px solid var(--border-color-default, #d0d7de);background:#fff}.prototype-review{padding:12px;border:1px solid var(--studio-border);border-radius:8px;background:var(--background-color-default, #fff)}.prototype-review-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px}.prototype-review-heading strong{font-weight:var(--font-weight-semibold, 600)}.prototype-review-heading span{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.revision-form,.revision-question-form{display:grid;gap:8px}.revision-form textarea,.revision-question-form textarea{min-height:72px;resize:vertical;padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.revision-form button,.revision-question-form button{justify-self:end;padding:7px 12px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.revision-form button:disabled,.revision-question-form button:disabled{cursor:not-allowed;opacity:.55}.revision-question{margin-top:10px;padding:10px;border:1px solid var(--color-focus-outline, #0969da);border-radius:7px;background:var(--true-color-blue-muted, #ddf4ff)}.revision-question-title{margin:0 0 8px;font-weight:var(--font-weight-semibold, 600)}.revision-question-choices{display:grid;gap:6px}.revision-question-choice{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.revision-history{display:grid;gap:5px;margin:10px 0 0;padding:0;list-style:none}.revision-history li{display:flex;justify-content:space-between;gap:10px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.revision-history strong{color:var(--text-color-default, #1f2328);font-weight:var(--font-weight-medium, 500)}.revision-status{min-height:18px;margin:7px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.revision-status[data-status=error]{color:var(--true-color-red, #cf222e)}.preview-empty{display:grid;place-items:center;height:100%;min-height:260px;padding:24px;border:1px dashed var(--border-color-default, #d0d7de);color:var(--text-color-muted, #656d76);text-align:center;background:var(--background-color-default, #fff)}.content-panel{display:grid;grid-template-rows:minmax(0,1fr);min-height:0;padding:12px}.content-card{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;overflow:hidden;border:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.content-heading{padding:10px 12px;border-bottom:1px solid var(--border-color-default, #d0d7de)}.content-heading strong{display:block;font-weight:var(--font-weight-semibold, 600)}.artifact-meta{display:block;overflow:hidden;margin-top:2px;color:var(--text-color-muted, #656d76);font-family:var(--font-mono, "SFMono-Regular", Consolas, monospace);font-size:var(--text-code-inline, 12px);text-overflow:ellipsis;white-space:nowrap}.artifact-body{min-height:0;overflow:auto}.artifact-diagram{padding:14px;border-bottom:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-muted, #f6f8fa)}.diagram-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-bottom:7px}.diagram-toolbar button{min-width:30px;padding:4px 8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:5px;background:var(--background-color-default, #fff);color:var(--text-color-default, #1f2328);cursor:pointer;font-size:var(--text-body-small, 12px)}.diagram-toolbar button:hover{border-color:var(--studio-accent);background:var(--studio-accent-soft)}.diagram-toolbar-output{min-width:42px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-align:center}.mermaid-host{min-height:180px;overflow:auto;padding:12px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.mermaid-host svg{display:block;width:100%;min-width:520px;height:auto;margin:0 auto}.diagram-status{min-height:18px;margin:7px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.diagram-status[data-status=error]{color:var(--true-color-red, #cf222e)}.diagram-source{margin-top:8px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.diagram-source summary{width:fit-content;cursor:pointer}.diagram-source pre{overflow:auto;margin:7px 0 0;padding:10px;border:1px solid var(--border-color-default, #d0d7de);border-radius:4px;background:var(--background-color-default, #fff);color:var(--text-color-default, #1f2328);font-family:var(--font-mono, "SFMono-Regular", Consolas, monospace);font-size:var(--text-code-block, 12px);white-space:pre}.artifact-content{margin:0;padding:14px;color:var(--text-color-default, #1f2328);font-family:var(--font-mono, "SFMono-Regular", Consolas, monospace);font-size:var(--text-code-block, 12px);line-height:1.55;tab-size:2;white-space:pre-wrap;overflow-wrap:anywhere}.artifact-review{margin:0 14px 14px;border:1px solid var(--border-color-default, #d0d7de);border-radius:8px;background:var(--background-color-default, #fff)}.artifact-review-heading{display:grid;gap:2px;padding:11px 14px;border-bottom:1px solid var(--border-color-default, #d0d7de)}.artifact-review-heading span{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.artifact-review-threads{display:grid;gap:9px;padding:12px 14px}.artifact-review-threads:empty{display:none}.content-empty{display:grid;place-items:center;min-height:0;padding:24px;color:var(--text-color-muted, #656d76);text-align:center}.design-tree-panel{min-height:0;overflow:auto;padding:12px}.requirements-intake-panel{margin-bottom:12px}.requirements-intake-panel .requirements-substages{max-width:520px}@media(min-width:760px){.requirements-intake-panel .usage-form{grid-template-columns:minmax(0,1fr) auto}}.design-review-panel{min-height:0;padding:12px}.design-review-card{display:grid;grid-template-rows:auto auto minmax(0,1fr);height:100%;min-height:0;overflow:hidden;border:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.design-review-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;border-bottom:1px solid var(--border-color-default, #d0d7de)}.design-review-title{display:grid;gap:2px}.design-substages{display:flex;gap:6px;margin:0;padding:0;list-style:none}.design-substage{padding:3px 8px;border:1px solid var(--studio-border);border-radius:999px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.design-substage[data-status=active]{border-color:var(--studio-accent-strong);background:var(--studio-accent-soft);color:var(--studio-accent-strong);font-weight:var(--font-weight-semibold, 600)}.design-substage[data-status=complete]:before{content:"\\2713  ";color:var(--true-color-green, #1a7f37)}.design-review-title span,.design-review-status{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.finish-review,.review-submit,.thread-action{padding:7px 11px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.finish-review:disabled,.review-submit:disabled,.thread-action:disabled{cursor:not-allowed;opacity:.55}.design-review-threads{min-height:0;overflow:auto;padding:14px;background:var(--background-color-muted, #f6f8fa)}.design-review-empty{display:grid;place-items:center;min-height:180px;margin:0;color:var(--text-color-muted, #656d76);text-align:center}.review-thread{padding:12px;border:1px solid var(--border-color-default, #d0d7de);border-radius:8px;background:var(--background-color-default, #fff)}.review-thread+.review-thread{margin-top:10px}.review-thread[data-status=resolved]{border-color:var(--true-color-green, #1a7f37)}.review-thread[data-status=failed]{border-color:var(--true-color-red, #cf222e)}.review-thread-heading,.review-thread-actions,.review-composer-actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.review-thread-kind,.review-thread-state{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.review-thread-state{padding:2px 7px;border:1px solid var(--border-color-default, #d0d7de);border-radius:999px}.review-thread-prompt{margin:9px 0 0;font-weight:var(--font-weight-semibold, 600);white-space:pre-wrap}.review-thread-answer{margin:9px 0 0;color:var(--text-color-default, #1f2328);white-space:pre-wrap}.review-thread-error{margin:9px 0 0;color:var(--true-color-red, #cf222e);font-size:var(--text-body-small, 12px)}.review-thread-artifacts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.review-artifact-link{padding:4px 8px;border:1px solid var(--studio-border);border-radius:999px;background:var(--studio-accent-soft);cursor:pointer;font-size:var(--text-body-small, 12px)}.review-thread-actions{justify-content:flex-end;margin-top:10px}.thread-action{padding:5px 9px;background:var(--background-color-default, #fff);color:var(--studio-accent-strong)}.design-review-composer{display:grid;gap:9px;padding:12px 14px;border-top:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.review-request-kind{padding:7px 9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.design-review-composer textarea{min-height:74px;resize:vertical;padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.design-review-status[data-status=error]{color:var(--true-color-red, #cf222e)}.plan-panel{min-height:0;overflow:auto;padding:12px}.plan-workspace{display:grid;gap:12px}.plan-heading,.plan-controls,.plan-actions,.plan-wave-heading,.plan-work-item-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.plan-heading{padding:12px 14px;border:1px solid var(--studio-border);border-radius:8px;background:var(--background-color-default, #fff)}.plan-heading-copy{display:grid;gap:2px}.plan-heading-copy span,.plan-status,.plan-work-item-meta,.plan-agent-meta{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.plan-controls{justify-content:flex-end;flex-wrap:wrap}.plan-agent-limit{display:inline-flex;align-items:center;gap:6px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.plan-agent-limit input{width:58px;padding:6px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.plan-button{padding:7px 11px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.plan-button.secondary{background:var(--background-color-default, #fff);color:var(--studio-accent-strong)}.plan-button:disabled{cursor:not-allowed;opacity:.55}.plan-metrics{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:8px}.plan-metric{padding:10px;border:1px solid var(--studio-border);border-radius:7px;background:var(--background-color-default, #fff)}.plan-metric strong,.plan-metric span{display:block}.plan-metric strong{font-size:var(--text-title-medium, 18px)}.plan-metric span{margin-top:2px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.plan-section{padding:12px;border:1px solid var(--studio-border);border-radius:8px;background:var(--background-color-default, #fff)}.plan-section>h3{margin:0 0 9px;font-size:var(--text-body-medium, 14px)}.plan-strategy{margin:0;white-space:pre-wrap}.plan-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,30%);gap:12px;align-items:start}.plan-main,.plan-sidebar,.plan-waves,.plan-work-items,.plan-agents{display:grid;gap:9px}.plan-wave{padding:10px;border-left:3px solid var(--studio-accent);border-radius:0 7px 7px 0;background:var(--studio-accent-soft)}.plan-wave-heading strong{font-weight:var(--font-weight-semibold, 600)}.plan-wave-heading span{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.plan-wave-items{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.plan-wave-item{padding:4px 7px;border:1px solid var(--studio-border);border-radius:999px;background:var(--background-color-default, #fff);font-size:var(--text-body-small, 12px)}.plan-work-item{border:1px solid var(--border-color-default, #d0d7de);border-radius:7px;background:var(--background-color-default, #fff)}.plan-work-item summary{padding:9px 10px;cursor:pointer}.plan-work-item-body{padding:0 10px 10px;border-top:1px solid var(--border-color-default, #d0d7de)}.plan-work-item-body p{margin:9px 0}.plan-work-item-body ul,.plan-risks{margin:6px 0 0;padding-left:20px}.plan-agent{padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:7px}.plan-agent strong{display:block}.plan-revision-form{display:grid;gap:8px}.plan-revision-form textarea{min-height:74px;resize:vertical;padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.plan-status[data-status=error]{color:var(--true-color-red, #cf222e)}.implementation-panel{min-height:0;overflow:auto;padding:12px}.implementation-workspace,.implementation-list,.implementation-agents,.implementation-events,.implementation-strategies{display:grid;gap:9px}.implementation-heading,.implementation-heading-copy,.implementation-controls,.implementation-progress-copy,.implementation-card-heading,.implementation-event-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.implementation-heading{padding:12px 14px;border:1px solid var(--studio-border);border-radius:8px;background:var(--background-color-default, #fff)}.implementation-heading-copy{display:grid;justify-content:start;gap:2px}.implementation-heading-copy span,.implementation-meta,.implementation-status{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.implementation-controls{justify-content:flex-end;flex-wrap:wrap}.implementation-progress-track{height:8px;overflow:hidden;margin-top:9px;border-radius:999px;background:var(--background-color-muted, #eaeef2)}.implementation-progress-bar{width:0;height:100%;border-radius:inherit;background:var(--studio-accent-strong);transition:width .2s ease}.implementation-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);gap:12px;align-items:start}.implementation-main,.implementation-sidebar{display:grid;gap:12px}.implementation-card,.implementation-event,.implementation-strategy{padding:10px;border:1px solid var(--border-color-default, #d0d7de);border-radius:7px;background:var(--background-color-default, #fff)}.implementation-card[data-status=running]{border-color:var(--studio-accent-strong);box-shadow:inset 3px 0 0 var(--studio-accent-strong)}.implementation-card[data-status=completed]{box-shadow:inset 3px 0 0 var(--true-color-green, #1a7f37)}.implementation-card[data-status=failed],.implementation-card[data-status=blocked],.implementation-card[data-status=cancelled]{box-shadow:inset 3px 0 0 var(--true-color-red, #cf222e)}.implementation-badge{flex:0 0 auto;padding:2px 7px;border:1px solid var(--studio-border);border-radius:999px;color:var(--text-color-muted, #656d76);font-size:11px;text-transform:capitalize}.implementation-card p,.implementation-event p,.implementation-strategy p{margin:6px 0 0}.test-error-toggle{width:100%;margin-top:9px;padding:7px 9px;border:1px solid var(--true-color-red, #cf222e);border-radius:6px;background:transparent;color:var(--true-color-red, #cf222e);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.test-error-details{max-height:360px;overflow:auto;margin:9px 0 0;padding:10px;border:1px solid var(--true-color-red, #cf222e);border-radius:6px;background:var(--background-color-muted, #f6f8fa);color:var(--text-color-default, #1f2328);font-family:var(--font-mono, ui-monospace, "SFMono-Regular", Consolas, monospace);font-size:11px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.implementation-strategy-form{display:grid;gap:8px}.implementation-strategy-form textarea{min-height:74px;resize:vertical;padding:9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.implementation-event time{color:var(--text-color-muted, #656d76);font-size:11px}.implementation-status[data-status=error]{color:var(--true-color-red, #cf222e)}@media(max-width:980px){.plan-metrics{grid-template-columns:repeat(2,minmax(120px,1fr))}.plan-columns,.implementation-grid,.preparation-stage-grid{grid-template-columns:1fr}}.design-tree-card{display:grid;grid-template-columns:minmax(340px,1fr) minmax(280px,34%);grid-template-rows:auto minmax(0,1fr);height:100%;min-height:0;overflow:hidden;border:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.design-tree-heading{display:flex;grid-column:1 / -1;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 14px;border-bottom:1px solid var(--border-color-default, #d0d7de)}.design-tree-location{display:grid;gap:3px;min-width:0}.design-tree-location span{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600);letter-spacing:.04em;text-transform:uppercase}.design-tree-location strong{overflow-wrap:anywhere}.design-tree-phase{flex:0 0 auto;padding:3px 8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:999px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.design-tree-body{grid-column:1;min-height:0;overflow:auto;padding:14px;background:var(--background-color-muted, #f6f8fa)}.design-tree-inspector{grid-column:2;min-height:0;overflow:auto;padding:14px;border-left:1px solid var(--border-color-default, #d0d7de);background:var(--background-color-default, #fff)}.design-tree-inspector .eyebrow{margin-bottom:8px}.design-tree-host g.node[data-selectable=true]{cursor:pointer}.design-tree-host g.node[data-selectable=true]:focus-visible{outline:3px solid var(--color-focus-outline, #0969da);outline-offset:4px}.decision-list{display:grid;gap:8px;padding-left:24px}.decision-list button{width:100%;padding:8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff);text-align:left;cursor:pointer}.decision-list button[aria-pressed=true]{border-color:var(--color-focus-outline, #0969da)}.decision-list button:disabled{cursor:default}.design-tree-host g.node[data-status=answered]>rect{fill:var(--true-color-green-muted, #dafbe1)!important}.design-tree-host g.node[data-status=active]>rect{fill:var(--true-color-blue-muted, #ddf4ff)!important}.design-tree-host g.node[data-status=toAnswer]>rect{fill:var(--background-color-muted, #f6f8fa)!important}.design-tree-host g.node text{fill:var(--text-color-default, #1f2328)!important}.design-tree-host g.node[data-selected=true]>rect,.design-tree-host g.node[data-selected=true]>polygon,.design-tree-host g.node[data-selected=true]>path{filter:drop-shadow(0 0 3px var(--color-focus-outline, #0969da));stroke-width:4px!important}.design-tree-host{min-height:320px}.design-tree-legend{display:flex;flex-wrap:wrap;gap:8px 16px;margin:0 0 10px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.design-tree-legend span{display:inline-flex;align-items:center;gap:6px}.design-tree-legend i{width:10px;height:10px;border:2px solid var(--border-color-default, #d0d7de);border-radius:3px;background:var(--background-color-default, #fff)}.design-tree-legend .answered{border-color:var(--true-color-green, #1a7f37);background:var(--true-color-green-muted, #dafbe1)}.design-tree-legend .active{border-color:var(--color-focus-outline, #0969da);background:var(--true-color-blue-muted, #ddf4ff)}.design-tree-legend .to-answer{border-color:var(--true-color-yellow, #bf8700);background:var(--true-color-yellow-muted, #fff8c5)}.section{margin-bottom:14px;padding:14px;border:1px solid var(--studio-border);border-radius:10px;background:var(--studio-card);box-shadow:0 1px 3px color-mix(in srgb,var(--studio-accent) 9%,transparent)}.section:last-child{margin-bottom:0}.preparation-status{padding:2px 7px;border-radius:999px;background:var(--background-color-muted, #f6f8fa);color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.preparation-status[data-status=ready]{background:var(--true-color-green-muted, #dafbe1);color:var(--true-color-green, #1a7f37)}.preparation-status[data-status=needs-attention]{background:var(--true-color-yellow-muted, #fff8c5);color:var(--true-color-yellow, #9a6700)}.preparation-panel{height:100%;overflow:auto;padding:14px;background:var(--studio-panel)}.preparation-stage-card{display:grid;gap:12px}.preparation-stage-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px;border:1px solid var(--studio-border);border-radius:9px;background:var(--studio-card)}.preparation-stage-heading .eyebrow,.preparation-stage-heading p{margin-top:0}.preparation-stage-heading p:last-child{margin-bottom:0}.preparation-stage-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);gap:12px;align-items:start}.preparation-stage-main,.preparation-stage-sidebar{display:grid;gap:12px}.preparation-result-list{display:grid;gap:7px;margin-top:10px}.preparation-result-suggestions{margin-top:10px}.preparation-result-suggestions ul{margin:6px 0 0;padding-left:20px}.preparation-result-item{display:grid;gap:3px;padding:8px;border:1px solid var(--studio-border);border-radius:6px;font-size:var(--text-body-small, 12px)}.preparation-result-item[data-status=ready]{box-shadow:inset 3px 0 0 var(--true-color-green, #1a7f37)}.preparation-result-item[data-status=missing],.preparation-result-item[data-status=deferred]{box-shadow:inset 3px 0 0 var(--true-color-yellow, #9a6700)}.preparation-result-sources{display:grid;gap:6px;margin-top:10px}.preparation-result-sources a{color:var(--color-accent-fg, #0969da)}.retry-preparation{width:100%;margin-top:9px;padding:8px 10px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.stage-list{display:grid;gap:7px;margin:0;padding:0;list-style:none}.stage-step{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;padding:8px 9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff);text-align:left}.stage-step[data-status=active]{border-color:var(--color-focus-outline, #0969da);background:var(--true-color-blue-muted, #ddf4ff)}.stage-step[data-status=complete]{border-color:var(--true-color-green, #1a7f37)}.stage-step:disabled{color:var(--text-color-muted, #656d76);cursor:not-allowed;opacity:.62}.stage-step-index{display:grid;place-items:center;width:22px;height:22px;border:1px solid currentColor;border-radius:50%;font-size:var(--text-body-small, 12px)}.stage-step-label{min-width:0;font-weight:var(--font-weight-semibold, 600)}.stage-step-status{color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);text-transform:capitalize}.stage-step-hint{margin:4px 9px 0 41px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);line-height:1.35}.complete-stage{width:100%;margin-top:10px;padding:8px 10px;border:1px solid var(--studio-accent-strong);border-radius:6px;background:var(--studio-accent-strong);color:var(--color-white, #fff);cursor:pointer;font-weight:var(--font-weight-semibold, 600)}.complete-stage:disabled{cursor:not-allowed;opacity:.55}.stage-message{min-height:18px;margin:7px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);overflow-wrap:anywhere}.stage-message[data-status=error]{color:var(--true-color-red, #cf222e)}.requirements-substages{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0 0 12px;padding:0;list-style:none}.requirements-substage{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:center;gap:7px;padding:7px 8px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.requirements-substage[data-status=active]{border-color:var(--color-focus-outline, #0969da);background:var(--true-color-blue-muted, #ddf4ff);color:var(--text-color-default, #1f2328)}.requirements-substage[data-status=complete]{border-color:var(--true-color-green, #1a7f37);color:var(--text-color-default, #1f2328)}.requirements-substage-index{display:grid;place-items:center;width:20px;height:20px;border:1px solid currentColor;border-radius:50%;font-size:11px}.usage-intro{margin:0 0 10px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.usage-items,.usage-suggestions{display:grid;gap:6px;margin:0 0 10px;padding:0;list-style:none}.usage-item{padding:7px 9px;border-left:3px solid var(--true-color-green, #1a7f37);border-radius:0 5px 5px 0;background:var(--true-color-green-muted, #dafbe1);overflow-wrap:anywhere}.usage-form{display:grid;gap:7px;margin-bottom:12px}.usage-form input{width:100%;padding:8px 9px;border:1px solid var(--border-color-default, #d0d7de);border-radius:6px;background:var(--background-color-default, #fff)}.usage-form button,.usage-suggestion,.generate-dag{padding:7px 9px;border:1px solid var(--studio-accent-strong);border-radius:6px;cursor:pointer}.usage-form button,.generate-dag{background:var(--studio-accent-strong);color:var(--color-white, #fff);font-weight:var(--font-weight-semibold, 600)}.usage-suggestion{width:100%;background:var(--studio-accent-soft);color:var(--text-color-default, #1f2328);text-align:left}.usage-form button:disabled,.usage-suggestion:disabled,.generate-dag:disabled{cursor:not-allowed;opacity:.55}.usage-suggestion-heading{margin:0 0 7px;color:var(--studio-accent-strong);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600)}.generate-dag{width:100%}.usage-message{min-height:18px;margin:7px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.usage-message[data-status=error]{color:var(--true-color-red, #cf222e)}.eyebrow{display:flex;align-items:center;gap:7px;margin:0 0 6px;color:var(--studio-accent-strong);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600);letter-spacing:.04em;text-transform:uppercase}.eyebrow:before{width:7px;height:7px;border-radius:2px;background:var(--studio-accent);content:"";transform:rotate(45deg)}.goal{margin:0;white-space:pre-wrap}.muted{color:var(--text-color-muted, #656d76)}.status{margin:9px 0 0;padding:7px 9px;border-left:3px solid var(--studio-accent);border-radius:0 5px 5px 0;background:var(--studio-accent-soft);color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.status:empty{display:none}#design-review-stage-status{margin:0;padding:0 14px}#design-review-stage-status:empty{display:none}#plan-status[data-status=error],#design-review-stage-status[data-status=error]{color:var(--true-color-red, #cf222e)}.question-card{padding:12px;border:1px solid var(--studio-border);border-radius:7px;background:var(--background-color-default, #fff)}.processing-state,.processing-error,.provider-notice{display:flex;align-items:flex-start;gap:9px;margin:0;padding:10px;border-radius:7px;font-size:var(--text-body-small, 12px)}.processing-state{position:relative;min-height:48px;overflow:hidden;border:1px solid var(--studio-border);background:var(--studio-accent-soft)}.processing-state:after{position:absolute;inset:0;background:linear-gradient(110deg,transparent 20%,color-mix(in srgb,var(--studio-accent) 12%,transparent) 48%,transparent 76%);content:"";pointer-events:none;transform:translate(-100%);animation:processing-shimmer 2.4s ease-in-out infinite}.processing-error{margin-bottom:10px;border:1px solid color-mix(in srgb,var(--true-color-red, #cf222e) 45%,var(--studio-border));background:color-mix(in srgb,var(--background-color-default, #fff) 93%,var(--true-color-red, #cf222e));color:var(--true-color-red, #cf222e)}.provider-notice{margin-bottom:10px;border:1px solid var(--studio-border);background:var(--studio-accent-soft);color:var(--text-color-muted, #656d76)}.processing-indicator{width:18px;height:18px;margin-top:1px;flex:0 0 auto;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 18%,var(--studio-accent) 42%,var(--studio-accent-strong) 100%);-webkit-mask:radial-gradient(circle,transparent 45%,#000 48%);mask:radial-gradient(circle,transparent 45%,#000 48%);animation:processing-spin .9s linear infinite}.processing-copy{display:grid;gap:4px;min-width:0}.processing-copy strong{color:var(--text-color-default, #1f2328)}.processing-heading{display:flex;align-items:baseline;gap:6px}.processing-dots{display:inline-flex;align-items:center;gap:3px}.processing-dots i{width:4px;height:4px;border-radius:50%;background:var(--studio-accent-strong);animation:processing-dot 1.1s ease-in-out infinite}.processing-dots i:nth-child(2){animation-delay:.14s}.processing-dots i:nth-child(3){animation-delay:.28s}@keyframes processing-spin{to{transform:rotate(360deg)}}@keyframes processing-dot{0%,60%,to{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}@keyframes processing-shimmer{0%,25%{transform:translate(-100%)}75%,to{transform:translate(100%)}}@keyframes next-action-beacon{0%{box-shadow:0 0 color-mix(in srgb,var(--next-action-color) 45%,transparent)}70%,to{box-shadow:0 0 0 7px transparent}}@keyframes next-action-target-pulse{0%,to{box-shadow:0 0 0 2px var(--background-color-default, #fff),0 0 0 4px color-mix(in srgb,var(--next-action-color) 80%,transparent)}50%{box-shadow:0 0 0 2px var(--background-color-default, #fff),0 0 0 6px color-mix(in srgb,var(--next-action-color) 35%,transparent)}}@media(prefers-reduced-motion:reduce){.processing-dots i,.processing-state:after,.preview-tab.next-action-tab:before,.next-action-target{animation:none}}.question{margin:0;font-size:var(--text-body-large, 15px);line-height:22px;font-weight:var(--font-weight-semibold, 600)}.rationale{margin:6px 0 0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}.choices{display:grid;gap:7px;margin:12px 0}.choice{display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--studio-border);border-radius:7px;background:var(--background-color-default, #fff);cursor:pointer}.choice:hover,.choice:focus-within{border-color:var(--studio-accent);background:var(--studio-accent-soft)}.choice:has(input:checked){border-color:var(--studio-accent);background:var(--studio-accent-soft)}.choice input{margin-top:3px}.recommended{margin-left:auto;color:var(--text-color-muted, #656d76);font-size:11px}textarea{width:100%;min-height:70px;resize:vertical;padding:8px;border:1px solid var(--studio-border);border-radius:4px;background:var(--background-color-default, #fff)}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:9px}.send,.all-recommended{padding:6px 12px;border:1px solid var(--studio-accent-strong);border-radius:7px;cursor:pointer}.send{background:var(--studio-accent-strong);color:var(--background-color-default, #fff)}.all-recommended{background:var(--background-color-default, #fff);color:var(--studio-accent-strong)}.send:disabled,.all-recommended:disabled{cursor:not-allowed;opacity:.5}.error{min-height:20px;margin:0;color:var(--true-color-red, #cf222e);font-size:var(--text-body-small, 12px)}.ledger{display:grid;gap:11px}.ledger-details{display:block}.ledger-summary{margin:0;cursor:pointer}.ledger-details[open] .ledger-summary{margin-bottom:11px}.ledger h3{display:flex;align-items:center;gap:6px;margin:0 0 4px;font-size:var(--text-body-medium, 14px);font-weight:var(--font-weight-semibold, 600)}.ledger h3:before{width:3px;height:12px;border-radius:2px;background:var(--studio-accent);content:"";opacity:.75}.ledger ul{margin:0;padding-left:18px}.ledger li+li{margin-top:3px}.artifact-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.artifact-stage-group{display:grid;gap:4px}.artifact-stage-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px);font-weight:var(--font-weight-semibold, 600)}.artifact-stage-heading span{font-weight:var(--font-weight-normal, 400)}.artifact-stage-items{display:grid;gap:4px;margin:0;padding:0;list-style:none}.artifact-stage-items .empty-item{margin-left:0}.artifact-button{display:grid;width:100%;min-width:0;padding:7px 8px;border:1px solid transparent;border-radius:7px;background:transparent;text-align:left;cursor:pointer}.artifact-button:hover,.artifact-button:focus-visible,.artifact-button[aria-current=true]{border-color:var(--studio-border);background:var(--studio-accent-soft)}.artifact-title,.artifact-list-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.artifact-title{font-weight:var(--font-weight-semibold, 600)}.artifact-list-meta{color:var(--text-color-muted, #656d76);font-family:var(--font-mono, "SFMono-Regular", Consolas, monospace);font-size:var(--text-code-inline, 12px)}.empty-item{list-style:none;margin-left:-18px;color:var(--text-color-muted, #656d76);font-size:var(--text-body-small, 12px)}@media(max-width:760px){html,body{overflow:auto}.app{height:auto;min-height:100%}.workspace{grid-template-columns:1fr;grid-template-rows:auto minmax(520px,65vh)}.splitter{display:none}.requirements{overflow:visible;border-bottom:1px solid var(--studio-border)}}@media(max-width:980px){.brand-subtitle,.reload-status{display:none}}@container output (max-width: 680px){.preparation-stage-grid{grid-template-columns:minmax(0,1fr)}.preparation-stage-main,.preparation-stage-sidebar{min-width:0;overflow-wrap:anywhere}.design-tree-card{grid-template-columns:1fr;grid-template-rows:auto minmax(240px,auto) auto;height:auto;min-height:100%;overflow:auto}.design-tree-body,.design-tree-inspector{grid-column:1}.design-tree-inspector{border-top:1px solid var(--border-color-default, #d0d7de);border-left:0}}\n';

// src/renderer/index.html
var renderer_default = '<!doctype html>\r\n<html lang="en">\r\n<head>\r\n  <meta charset="utf-8" />\r\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\r\n  <title>Tandem</title>\r\n  <style>__TANDEM_STYLES__</style>\r\n</head>\r\n<body>\r\n  <div class="app">\r\n    <header class="topbar">\r\n      <div class="brand">\r\n        <div class="mark" aria-hidden="true">T</div>\r\n        <div class="brand-copy">\r\n          <h1>Tandem</h1>\r\n          <span class="brand-subtitle">Lifecycle design workspace</span>\r\n        </div>\r\n      </div>\r\n      <div class="topbar-actions">\r\n        <span\r\n          id="next-action-guide"\r\n          class="visually-hidden"\r\n          role="status"\r\n          aria-live="polite"\r\n        ></span>\r\n        <div class="lifecycle" aria-label="Development lifecycle">\r\n          <span id="current-stage" class="stage" aria-label="Current lifecycle stage">\r\n            <span id="current-stage-index" class="stage-index" aria-hidden="true">1</span>\r\n            <span id="stage">Preparation</span>\r\n          </span>\r\n          <span id="phase" class="phase">Building</span>\r\n        </div>\r\n        <div class="reload-control">\r\n          <button id="reload-extension" class="reload-button" type="button">\r\n            Reload latest installed\r\n          </button>\r\n          <span id="reload-status" class="reload-status" role="status" aria-live="polite"></span>\r\n        </div>\r\n        <span class="build-version" title="Tandem extension version">v__TANDEM_VERSION__</span>\r\n      </div>\r\n    </header>\r\n\r\n    <main id="studio-workspace" class="workspace">\r\n      <aside id="requirements-pane" class="requirements" aria-label="Prototype requirements">\r\n        <section class="section">\r\n          <p class="eyebrow">Goal</p>\r\n          <p id="goal" class="goal muted">Waiting for a prototype goal...</p>\r\n          <p id="status" class="status"></p>\r\n          <p id="connection-status" class="status" role="status" aria-live="polite"></p>\r\n        </section>\r\n\r\n        <section class="section">\r\n          <p class="eyebrow">Stages</p>\r\n          <ol id="stage-list" class="stage-list"></ol>\r\n          <button id="complete-stage" class="complete-stage" type="button">\r\n            Preparation runs automatically\r\n          </button>\r\n          <p id="stage-browsing" class="stage-message"></p>\r\n          <button id="reopen-stage" class="complete-stage" type="button" hidden>\r\n            Reopen stage\r\n          </button>\r\n          <p id="stage-message" class="stage-message" role="status" aria-live="polite"></p>\r\n        </section>\r\n\r\n        <section class="section">\r\n          <p class="eyebrow">Artifacts</p>\r\n          <div id="artifact-list" class="artifact-list"></div>\r\n        </section>\r\n\r\n        <details class="section ledger-details">\r\n          <summary class="eyebrow ledger-summary">Requirement ledger</summary>\r\n          <div class="ledger">\r\n            <div>\r\n              <h3>Confirmed</h3>\r\n              <ul id="confirmed"></ul>\r\n            </div>\r\n            <div>\r\n              <h3>Assumed</h3>\r\n              <ul id="assumed"></ul>\r\n            </div>\r\n            <div>\r\n              <h3>Deferred</h3>\r\n              <ul id="deferred"></ul>\r\n            </div>\r\n          </div>\r\n        </details>\r\n      </aside>\r\n\r\n      <div\r\n        id="studio-splitter"\r\n        class="splitter"\r\n        role="separator"\r\n        aria-label="Resize requirements and output panels"\r\n        aria-orientation="vertical"\r\n        aria-controls="requirements-pane preview-pane"\r\n        aria-valuemin="280"\r\n        aria-valuenow="280"\r\n        tabindex="0"\r\n        title="Drag or use Left and Right arrow keys to resize"\r\n      ></div>\r\n\r\n      <section id="preview-pane" class="preview" aria-label="Prototype output">\r\n        <div class="previewbar">\r\n          <div class="preview-tabs" role="tablist" aria-label="Prototype output">\r\n            <button\r\n              id="preparation-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="true"\r\n              aria-controls="preparation-panel"\r\n              data-tab="preparation"\r\n            >Preparation</button>\r\n            <button\r\n              id="design-tree-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="design-tree-panel"\r\n              tabindex="-1"\r\n              data-tab="design-tree"\r\n            >Requirements</button>\r\n            <button\r\n              id="live-preview-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="live-preview-panel"\r\n              tabindex="-1"\r\n              data-tab="preview"\r\n            >Live prototype</button>\r\n            <button\r\n              id="design-review-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="design-review-panel"\r\n              tabindex="-1"\r\n              data-tab="design-review"\r\n            >Design review <span id="review-count" class="artifact-count"></span></button>\r\n            <button\r\n              id="plan-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="plan-panel"\r\n              tabindex="-1"\r\n              data-tab="plan"\r\n              hidden\r\n            >Execution plan</button>\r\n            <button\r\n              id="implementation-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="implementation-panel"\r\n              tabindex="-1"\r\n              data-tab="implementation"\r\n              hidden\r\n            >Implementation</button>\r\n            <button\r\n              id="test-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="test-panel"\r\n              tabindex="-1"\r\n              data-tab="test"\r\n              hidden\r\n            >Tests</button>\r\n            <button\r\n              id="content-tab"\r\n              class="preview-tab"\r\n              type="button"\r\n              role="tab"\r\n              aria-selected="false"\r\n              aria-controls="content-panel"\r\n              tabindex="-1"\r\n              data-tab="content"\r\n            >Content <span id="artifact-count" class="artifact-count"></span></button>\r\n          </div>\r\n          <div id="preview-tools" class="preview-tools">\r\n            <span id="preview-status" class="preview-status">Waiting</span>\r\n            <a id="open-preview" class="open-preview" target="_blank" rel="noreferrer">Open separately</a>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="preparation-panel"\r\n          class="preparation-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="preparation-tab"\r\n          tabindex="0"\r\n        >\r\n          <section class="preparation-stage-card">\r\n            <div class="preparation-stage-heading">\r\n              <div>\r\n                <p class="eyebrow">Environment preparation</p>\r\n                <strong id="preparation-stage-title">Preparing Tandem context</strong>\r\n                <p id="preparation-stage-progress" class="muted">\r\n                  The preparation worker will inspect the workspace and analyze authoritative sources.\r\n                </p>\r\n              </div>\r\n              <span id="preparation-stage-status" class="preparation-status">Not started</span>\r\n            </div>\r\n            <div class="preparation-stage-grid">\r\n              <div class="preparation-stage-main">\r\n                <section class="plan-section">\r\n                  <h3>Work items</h3>\r\n                  <div id="preparation-work-items" class="implementation-list"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Results</h3>\r\n                  <p id="preparation-result-summary" class="muted">\r\n                    Results will appear as preparation completes.\r\n                  </p>\r\n                  <div id="preparation-result-suggestions" class="preparation-result-suggestions"></div>\r\n                  <div id="preparation-result-checks" class="preparation-result-list"></div>\r\n                  <div id="preparation-result-sources" class="preparation-result-sources"></div>\r\n                </section>\r\n              </div>\r\n              <aside class="preparation-stage-sidebar">\r\n                <section class="plan-section">\r\n                  <h3>Progress</h3>\r\n                  <div id="preparation-messages" class="implementation-events"></div>\r\n                  <button id="retry-preparation" class="retry-preparation" type="button" hidden>\r\n                    Retry preparation\r\n                  </button>\r\n                  <p id="preparation-stage-message" class="implementation-status" role="status" aria-live="polite"></p>\r\n                </section>\r\n              </aside>\r\n            </div>\r\n          </section>\r\n        </div>\r\n        <div\r\n          id="live-preview-panel"\r\n          class="frame-wrap"\r\n          role="tabpanel"\r\n          aria-labelledby="live-preview-tab"\r\n          hidden\r\n        >\r\n          <div class="preview-surface">\r\n            <div\r\n              id="prototype-building"\r\n              class="prototype-building"\r\n              role="status"\r\n              aria-live="polite"\r\n              aria-atomic="true"\r\n              hidden\r\n            >\r\n              <div class="prototype-building-card">\r\n                <span class="processing-indicator" aria-hidden="true"></span>\r\n                <span class="processing-copy">\r\n                  <span class="processing-heading">\r\n                    <strong id="prototype-building-title">Building runnable prototype</strong>\r\n                    <span class="processing-dots" aria-hidden="true"><i></i><i></i><i></i></span>\r\n                  </span>\r\n                  <span id="prototype-building-message" class="muted"></span>\r\n                  <span id="prototype-building-elapsed" class="muted" role="timer" aria-live="off"></span>\r\n                </span>\r\n              </div>\r\n            </div>\r\n            <div id="preview-empty" class="preview-empty">\r\n              <div>\r\n                <p id="preview-empty-message">The runnable prototype will appear here after the essential interaction decisions are captured.</p>\r\n                <button id="start-prototype" class="plan-button" type="button" hidden>Start prototype</button>\r\n                <p id="prototype-build-status" class="revision-status" role="status" aria-live="polite"></p>\r\n              </div>\r\n            </div>\r\n            <iframe\r\n              id="preview-frame"\r\n              title="Runnable prototype"\r\n              sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"\r\n            ></iframe>\r\n          </div>\r\n          <section id="prototype-review" class="prototype-review" hidden>\r\n            <div class="prototype-review-heading">\r\n              <strong>Suggest a prototype revision</strong>\r\n              <span>Iterate until no more changes are needed</span>\r\n            </div>\r\n            <form id="revision-form" class="revision-form">\r\n              <textarea\r\n                id="revision-input"\r\n                maxlength="4000"\r\n                placeholder="Describe one change you want to see in the prototype."\r\n                aria-label="Prototype revision suggestion"\r\n              ></textarea>\r\n              <button id="submit-revision" type="submit">Send revision</button>\r\n            </form>\r\n            <div id="revision-question" class="revision-question" hidden>\r\n              <p id="revision-question-title" class="revision-question-title"></p>\r\n              <p id="revision-question-rationale" class="rationale"></p>\r\n              <form id="revision-question-form" class="revision-question-form">\r\n                <div id="revision-question-choices" class="revision-question-choices"></div>\r\n                <textarea\r\n                  id="revision-question-detail"\r\n                  maxlength="4000"\r\n                  placeholder="Optional clarification"\r\n                  aria-label="Prototype clarification"\r\n                ></textarea>\r\n                <button id="submit-clarification" type="submit">Use this answer</button>\r\n              </form>\r\n            </div>\r\n            <ul id="revision-history" class="revision-history"></ul>\r\n            <p id="revision-status" class="revision-status" role="status" aria-live="polite"></p>\r\n          </section>\r\n        </div>\r\n        <div\r\n          id="plan-panel"\r\n          class="plan-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="plan-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <div class="plan-workspace">\r\n            <div class="plan-heading">\r\n              <div class="plan-heading-copy">\r\n                <strong>Implementation orchestration</strong>\r\n                <span id="plan-progress">Generate work items, schedule waves, and agent assignments.</span>\r\n              </div>\r\n              <div class="plan-controls">\r\n                <label class="plan-agent-limit">\r\n                  Max agents\r\n                  <input id="plan-max-agents" type="number" min="1" max="30" value="4" />\r\n                </label>\r\n                <button id="generate-plan" class="plan-button" type="button">\r\n                  Generate plan\r\n                </button>\r\n                <button id="finalize-plan" class="plan-button secondary" type="button">\r\n                  Finalize plan\r\n                </button>\r\n              </div>\r\n            </div>\r\n            <p id="plan-status" class="plan-status" role="status" aria-live="polite"></p>\r\n            <div id="plan-metrics" class="plan-metrics"></div>\r\n            <section id="plan-strategy-section" class="plan-section" hidden>\r\n              <h3>Orchestration strategy</h3>\r\n              <p id="plan-strategy" class="plan-strategy"></p>\r\n            </section>\r\n            <section id="plan-dag-section" class="plan-section" hidden>\r\n              <h3>Dependency DAG</h3>\r\n              <div id="plan-dag" class="mermaid-host" role="img" aria-label="Execution plan dependency graph"></div>\r\n              <p id="plan-dag-status" class="diagram-status" role="status" aria-live="polite"></p>\r\n            </section>\r\n            <div id="plan-columns" class="plan-columns" hidden>\r\n              <div class="plan-main">\r\n                <section class="plan-section">\r\n                  <h3>Parallel schedule</h3>\r\n                  <div id="plan-waves" class="plan-waves"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Implementation work items</h3>\r\n                  <div id="plan-work-items" class="plan-work-items"></div>\r\n                </section>\r\n              </div>\r\n              <aside class="plan-sidebar">\r\n                <section class="plan-section">\r\n                  <h3>Agent workload</h3>\r\n                  <div id="plan-agents" class="plan-agents"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Risks and coordination</h3>\r\n                  <ul id="plan-risks" class="plan-risks"></ul>\r\n                </section>\r\n              </aside>\r\n            </div>\r\n            <section id="plan-revision-section" class="plan-section" hidden>\r\n              <h3>Revise execution plan</h3>\r\n              <form id="plan-revision-form" class="plan-revision-form">\r\n                <textarea\r\n                  id="plan-revision-input"\r\n                  maxlength="4000"\r\n                  placeholder="Describe how assignments, dependencies, work-item scope, or schedule should change."\r\n                  aria-label="Execution plan revision"\r\n                ></textarea>\r\n                <div class="plan-actions">\r\n                  <button id="optimize-plan" class="plan-button secondary" type="button">\r\n                    Optimize parallelism\r\n                  </button>\r\n                  <button id="revise-plan" class="plan-button" type="submit">\r\n                    Revise plan\r\n                  </button>\r\n                </div>\r\n              </form>\r\n            </section>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="implementation-panel"\r\n          class="implementation-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="implementation-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <div class="implementation-workspace">\r\n            <div class="implementation-heading">\r\n              <div class="implementation-heading-copy">\r\n                <strong>Development execution</strong>\r\n                <span id="implementation-progress">Ready to assign the finalized work items.</span>\r\n              </div>\r\n              <div class="implementation-controls">\r\n                <button id="start-implementation" class="plan-button" type="button">\r\n                  Start implementation\r\n                </button>\r\n                <button id="stop-implementation" class="plan-button secondary" type="button" hidden>\r\n                  Stop run\r\n                </button>\r\n              </div>\r\n            </div>\r\n            <section class="plan-section">\r\n              <div class="implementation-progress-copy">\r\n                <strong>Overall progress</strong>\r\n                <span id="implementation-progress-label" class="implementation-meta">0 of 0 complete</span>\r\n              </div>\r\n              <div class="implementation-progress-track" aria-hidden="true">\r\n                <div id="implementation-progress-bar" class="implementation-progress-bar"></div>\r\n              </div>\r\n            </section>\r\n            <div id="implementation-metrics" class="plan-metrics"></div>\r\n            <div class="implementation-grid">\r\n              <div class="implementation-main">\r\n                <section class="plan-section">\r\n                  <h3>Execution waves</h3>\r\n                  <div id="implementation-waves" class="implementation-list"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Work items</h3>\r\n                  <div id="implementation-work-items" class="implementation-list"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Agent activity</h3>\r\n                  <div id="implementation-agents" class="implementation-agents"></div>\r\n                </section>\r\n              </div>\r\n              <aside class="implementation-sidebar">\r\n                <section class="plan-section">\r\n                  <h3>Adjust execution strategy</h3>\r\n                  <form id="implementation-strategy-form" class="implementation-strategy-form">\r\n                    <textarea\r\n                      id="implementation-strategy-input"\r\n                      maxlength="4000"\r\n                      placeholder="Change priority, validation depth, coordination, or guidance for the next wave."\r\n                      aria-label="Implementation strategy adjustment"\r\n                    ></textarea>\r\n                    <div class="plan-actions">\r\n                      <span id="implementation-status" class="implementation-status" role="status" aria-live="polite"></span>\r\n                      <button id="submit-implementation-strategy" class="plan-button" type="submit">\r\n                        Queue adjustment\r\n                      </button>\r\n                    </div>\r\n                  </form>\r\n                  <div id="implementation-strategies" class="implementation-strategies"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Recent activity</h3>\r\n                  <div id="implementation-events" class="implementation-events"></div>\r\n                </section>\r\n              </aside>\r\n            </div>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="test-panel"\r\n          class="implementation-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="test-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <div class="implementation-workspace">\r\n            <div class="implementation-heading">\r\n              <div class="implementation-heading-copy">\r\n                <strong>Integration and interaction tests</strong>\r\n                <span id="test-progress">Ready to execute the approved test specification.</span>\r\n              </div>\r\n              <button id="start-tests" class="plan-button" type="button">\r\n                Run tests\r\n              </button>\r\n            </div>\r\n            <section class="plan-section">\r\n              <div class="implementation-progress-copy">\r\n                <strong>Overall progress</strong>\r\n                <span id="test-progress-label" class="implementation-meta">0 of 0 passed</span>\r\n              </div>\r\n              <div class="implementation-progress-track" aria-hidden="true">\r\n                <div id="test-progress-bar" class="implementation-progress-bar"></div>\r\n              </div>\r\n            </section>\r\n            <div id="test-metrics" class="plan-metrics"></div>\r\n            <div class="implementation-grid">\r\n              <div class="implementation-main">\r\n                <section class="plan-section">\r\n                  <h3>Test scenarios</h3>\r\n                  <div id="test-scenarios" class="implementation-list"></div>\r\n                </section>\r\n                <section class="plan-section">\r\n                  <h3>Test agents</h3>\r\n                  <div id="test-agents" class="implementation-agents"></div>\r\n                </section>\r\n              </div>\r\n              <aside class="implementation-sidebar">\r\n                <section class="plan-section">\r\n                  <h3>Recent test activity</h3>\r\n                  <div id="test-events" class="implementation-events"></div>\r\n                  <p id="test-status" class="implementation-status" role="status" aria-live="polite"></p>\r\n                  <button\r\n                    id="test-error-toggle"\r\n                    class="test-error-toggle"\r\n                    type="button"\r\n                    aria-expanded="false"\r\n                    aria-controls="test-error-details"\r\n                    hidden\r\n                  >\r\n                    Show error details\r\n                  </button>\r\n                  <pre\r\n                    id="test-error-details"\r\n                    class="test-error-details"\r\n                    tabindex="0"\r\n                    hidden\r\n                  ></pre>\r\n                </section>\r\n              </aside>\r\n            </div>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="design-review-panel"\r\n          class="design-review-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="design-review-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <section class="design-review-card">\r\n            <div class="design-review-heading">\r\n              <div class="design-review-title">\r\n                <ol class="design-substages" aria-label="Design substages">\r\n                  <li id="product-design-substage" class="design-substage">1 \xB7 Product design</li>\r\n                  <li id="test-design-substage" class="design-substage">2 \xB7 Test design</li>\r\n                </ol>\r\n                <strong id="design-review-title">Product design review</strong>\r\n                <span id="design-review-progress">Ask questions and resolve the answers.</span>\r\n              </div>\r\n              <button id="finish-review" class="finish-review" type="button">\r\n                No more questions\r\n              </button>\r\n            </div>\r\n            <p id="design-review-stage-status" class="design-review-status" role="status" aria-live="polite"></p>\r\n            <div id="design-review-threads" class="design-review-threads"></div>\r\n          </section>\r\n        </div>\r\n        <div\r\n          id="design-tree-panel"\r\n          class="design-tree-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="design-tree-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <section\r\n            id="requirements-substage-section"\r\n            class="section requirements-intake-panel"\r\n          >\r\n            <p class="eyebrow">Requirements</p>\r\n            <ol class="requirements-substages" aria-label="Requirements substages">\r\n              <li id="usage-substage" class="requirements-substage">\r\n                <span class="requirements-substage-index">1</span>\r\n                <span>Usage list</span>\r\n              </li>\r\n              <li id="dag-substage" class="requirements-substage">\r\n                <span class="requirements-substage-index">2</span>\r\n                <span>Decision DAG</span>\r\n              </li>\r\n            </ol>\r\n            <div id="usage-intake">\r\n              <p class="usage-intro">\r\n                How do you want to use the app? Add one sentence for each usage.\r\n              </p>\r\n              <ul id="usage-items" class="usage-items"></ul>\r\n              <form id="usage-form" class="usage-form">\r\n                <input\r\n                  id="usage-input"\r\n                  type="text"\r\n                  maxlength="500"\r\n                  autocomplete="off"\r\n                  placeholder="I want to..."\r\n                  aria-label="Add one app usage"\r\n                />\r\n                <button id="add-usage" type="submit">Add usage</button>\r\n              </form>\r\n              <div id="usage-suggestion-area" hidden>\r\n                <p class="usage-suggestion-heading">AI suggestions \u2014 click to add</p>\r\n                <ul id="usage-suggestions" class="usage-suggestions"></ul>\r\n              </div>\r\n              <button id="generate-dag" class="generate-dag" type="button">\r\n                Generate requirements DAG\r\n              </button>\r\n            </div>\r\n            <p id="usage-message" class="usage-message" role="status" aria-live="polite"></p>\r\n          </section>\r\n          <div id="design-tree-card" class="design-tree-card" hidden>\r\n            <div class="design-tree-heading">\r\n              <div class="design-tree-location">\r\n                <span>You are here</span>\r\n                <strong id="design-tree-current">Waiting for the active decision...</strong>\r\n              </div>\r\n              <span id="design-tree-phase" class="design-tree-phase">Discovery</span>\r\n            </div>\r\n            <div class="design-tree-body">\r\n              <div class="design-tree-legend" aria-label="Decision status legend">\r\n                <span><i class="answered" aria-hidden="true"></i>Answered</span>\r\n                <span><i class="active" aria-hidden="true"></i>Active</span>\r\n                <span><i class="to-answer" aria-hidden="true"></i>To answer</span>\r\n              </div>\r\n              <div\r\n                id="design-tree-host"\r\n                class="mermaid-host design-tree-host"\r\n                role="group"\r\n                aria-label="Requirements decision DAG"\r\n              ></div>\r\n              <ol id="decision-list" class="decision-list" aria-label="Requirement decisions"></ol>\r\n              <p id="design-tree-status" class="diagram-status" role="status" aria-live="polite"></p>\r\n              <details id="design-tree-source-details" class="diagram-source">\r\n                <summary>Mermaid source</summary>\r\n                <pre id="design-tree-source"></pre>\r\n              </details>\r\n            </div>\r\n            <aside class="design-tree-inspector" aria-label="Selected decision">\r\n              <p class="eyebrow">Selected question</p>\r\n              <div id="question-host" class="question-card">\r\n                <p class="muted">The active decision will appear here.</p>\r\n              </div>\r\n            </aside>\r\n          </div>\r\n          <div id="design-tree-empty" class="content-empty">\r\n            <p>The requirements DAG will appear after the usage list is captured.</p>\r\n          </div>\r\n        </div>\r\n        <div\r\n          id="content-panel"\r\n          class="content-panel"\r\n          role="tabpanel"\r\n          aria-labelledby="content-tab"\r\n          tabindex="0"\r\n          hidden\r\n        >\r\n          <div id="content-card" class="content-card" hidden>\r\n            <div class="content-heading">\r\n              <strong id="artifact-heading">Artifact content</strong>\r\n              <span id="artifact-meta" class="artifact-meta"></span>\r\n            </div>\r\n            <div class="artifact-body">\r\n              <div id="artifact-diagram" class="artifact-diagram" hidden>\r\n                <div\r\n                  id="mermaid-host"\r\n                  class="mermaid-host"\r\n                  role="img"\r\n                  aria-label="Workflow diagram"\r\n                ></div>\r\n                <p id="diagram-status" class="diagram-status" role="status" aria-live="polite"></p>\r\n                <details id="diagram-source-details" class="diagram-source">\r\n                  <summary>Mermaid source</summary>\r\n                  <pre id="mermaid-source"></pre>\r\n                </details>\r\n              </div>\r\n              <pre id="artifact-content" class="artifact-content"></pre>\r\n              <section id="artifact-review" class="artifact-review" hidden>\r\n                <div class="artifact-review-heading">\r\n                  <strong>Artifact review</strong>\r\n                  <span>Questions and review decisions stay with this artifact.</span>\r\n                </div>\r\n                <div id="artifact-review-threads" class="artifact-review-threads"></div>\r\n                <form id="design-review-form" class="design-review-composer">\r\n                  <select\r\n                    id="review-request-kind"\r\n                    class="review-request-kind"\r\n                    aria-label="Artifact review request type"\r\n                  >\r\n                    <option value="question">Ask about this artifact</option>\r\n                    <option value="diagram">Generate a related diagram</option>\r\n                    <option value="contract">Generate a related contract</option>\r\n                    <option value="decision-record">Generate a related decision record</option>\r\n                    <option value="test-scenario">Generate a related test scenario</option>\r\n                  </select>\r\n                  <textarea\r\n                    id="design-review-input"\r\n                    maxlength="4000"\r\n                    placeholder="Ask about this artifact, its tradeoffs, behavior, or risks."\r\n                    aria-label="Artifact review question or request"\r\n                  ></textarea>\r\n                  <div class="review-composer-actions">\r\n                    <span id="design-review-status" class="design-review-status" role="status" aria-live="polite"></span>\r\n                    <button id="review-submit" class="review-submit" type="submit">\r\n                      Ask question\r\n                    </button>\r\n                  </div>\r\n                </form>\r\n              </section>\r\n            </div>\r\n          </div>\r\n          <div id="content-empty" class="content-empty">\r\n            <p>Captured artifacts will appear here as the prototype evolves.</p>\r\n          </div>\r\n        </div>\r\n      </section>\r\n    </main>\r\n  </div>\r\n\r\n  <script>__TANDEM_CLIENT__</script>\r\n</body>\r\n</html>\r\n';

// src/renderer.ts
var STYLES_TOKEN = "__TANDEM_STYLES__";
var CLIENT_TOKEN = "__TANDEM_CLIENT__";
var VERSION_TOKEN = "__TANDEM_VERSION__";
function injectAsset(template, token, content) {
  if (!template.includes(token)) {
    throw new Error(`Tandem renderer template is missing ${token}.`);
  }
  return template.replace(token, () => content);
}
function renderTandemHtml(version) {
  const withStyles = injectAsset(renderer_default, STYLES_TOKEN, styles_default);
  const withClient = injectAsset(withStyles, CLIENT_TOKEN, client_default);
  return injectAsset(withClient, VERSION_TOKEN, version);
}

// src/project-store.ts
var import_proper_lockfile = __toESM(require_proper_lockfile(), 1);
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
var ProjectStoreError = class extends Error {
  constructor(code, message, statusCode = 409, options) {
    super(message, options);
    this.code = code;
    this.statusCode = statusCode;
  }
  code;
  statusCode;
};
function normalizeProjectId(value) {
  const id = String(value || "active").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || id.endsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id)) {
    throw new ProjectStoreError("invalid_project_id", "Choose a project ID starting with a letter or number that is not a reserved filename.", 400);
  }
  return id;
}
async function readJsonFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return void 0;
    throw new ProjectStoreError("state_unreadable", `Cannot read ${path}. The saved file has been preserved.`, 503, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProjectStoreError("state_corrupt", `Invalid JSON in ${path}. Restore or repair this file before continuing; it has not been overwritten.`, 422, { cause: error });
  }
}
async function writeJsonAtomically(path, value, beforeCommit = () => {
}) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporaryPath, "wx");
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}
`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    beforeCommit();
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
var ProjectStore = class {
  constructor(options) {
    this.options = options;
  }
  options;
  transactions = new AsyncLocalStorage();
  statePath(id) {
    return join(this.options.root, "efforts", normalizeProjectId(id), "state.json");
  }
  stagePath(id, stage, revision) {
    if (!/^[a-z]+$/.test(stage)) throw new ProjectStoreError("invalid_stage", "Invalid lifecycle stage.", 400);
    return join(this.options.root, "efforts", normalizeProjectId(id), "stages", `${stage}${revision === void 0 ? "" : `-r${revision}`}.json`);
  }
  async locked(key, operation, rejectIfBusy) {
    const target = join(this.options.root, "locks", key);
    await mkdir(dirname(target), { recursive: true });
    let compromised;
    const assertOwned = () => {
      if (compromised) throw new ProjectStoreError("state_lock_lost", "Project ownership was lost. Reload before retrying.", 409, { cause: compromised });
    };
    let release;
    try {
      release = await import_proper_lockfile.default.lock(target, {
        realpath: false,
        stale: 3e4,
        update: 5e3,
        retries: rejectIfBusy ? 0 : { retries: 150, minTimeout: 100, maxTimeout: 100, factor: 1 },
        onCompromised: (error) => {
          compromised = error;
        }
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
        throw new ProjectStoreError("state_busy", "Another session is updating this project. Try again when it finishes.");
      }
      throw error;
    }
    try {
      const result = await operation(assertOwned);
      assertOwned();
      return result;
    } finally {
      if (!compromised) await release();
    }
  }
  async transaction(id, operation, rejectIfBusy = false) {
    id = normalizeProjectId(id);
    const existing = this.transactions.getStore();
    if (existing?.id === id && existing.active) {
      existing.assertOwned();
      return operation();
    }
    return this.locked(`effort-${id}`, async (assertOwned) => {
      const transaction = { id, assertOwned, active: true };
      try {
        return await this.transactions.run(transaction, operation);
      } finally {
        transaction.active = false;
      }
    }, rejectIfBusy);
  }
  decode(value, id) {
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("prototypeId" in value) || value.prototypeId !== id) {
      throw new ProjectStoreError("state_schema_invalid", `Saved state for "${id}" has an unsupported version or identity. The file has been preserved.`, 422);
    }
    if ("revision" in value && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0)) {
      throw new ProjectStoreError("state_schema_invalid", `Saved state for "${id}" has an invalid revision.`, 422);
    }
    return this.options.normalize(value, id);
  }
  async load(id) {
    id = normalizeProjectId(id);
    const stored = await readJsonFile(this.statePath(id));
    if (stored !== void 0) return this.decode(stored, id);
    return this.transaction(id, async () => {
      const current = await readJsonFile(this.statePath(id));
      if (current !== void 0) return this.decode(current, id);
      for (const path of this.options.legacyPaths?.(id) || []) {
        const legacy = await readJsonFile(path);
        if (legacy === void 0) continue;
        if (id === "current" && legacy && typeof legacy === "object" && Object.keys(legacy).every((key) => ["version", "prototypeId", "updatedAt"].includes(key))) continue;
        const state = this.decode(legacy, id);
        state.revision = 0;
        await this.save(state);
        return state;
      }
      return this.options.create(id);
    });
  }
  async save(state) {
    return this.transaction(state.prototypeId, async () => {
      const transaction = this.transactions.getStore();
      const stored = await readJsonFile(this.statePath(state.prototypeId));
      const revision = stored === void 0 ? 0 : this.decode(stored, state.prototypeId).revision;
      if (state.revision !== revision) {
        throw new ProjectStoreError("state_conflict", "This update is based on an older project revision. Reload and retry.");
      }
      const next = { ...state, revision: revision + 1 };
      await writeJsonAtomically(this.statePath(state.prototypeId), next, transaction.assertOwned);
      state.revision = next.revision;
    });
  }
  async current(legacyPaths = []) {
    for (const path of [join(this.options.root, "metadata", "current.json"), ...legacyPaths]) {
      const value = await readJsonFile(path);
      if (value === void 0) continue;
      if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("prototypeId" in value) || typeof value.prototypeId !== "string") {
        throw new ProjectStoreError("state_schema_invalid", `Invalid project pointer in ${path}. The file has been preserved.`, 422);
      }
      return normalizeProjectId(value.prototypeId);
    }
    return null;
  }
  async setCurrent(id) {
    id = normalizeProjectId(id);
    return this.locked("metadata-current", async (assertOwned) => {
      await this.current();
      await writeJsonAtomically(join(this.options.root, "metadata", "current.json"), {
        version: 1,
        prototypeId: id,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }, assertOwned);
    }, false);
  }
};

// src/agent-runner.ts
function jsonResult(value) {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonResult);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonResult(item)]));
  }
  throw new Error("The worker returned a value that cannot be persisted as JSON.");
}

// src/scheduling.ts
import { win32 } from "node:path";
function executionId(value) {
  if (typeof value !== "string") throw new Error("Execution IDs must be strings.");
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id || id.length > 120) throw new Error("Execution IDs must contain 1\u2013120 valid characters.");
  return id;
}
function executionGraph(value) {
  if (value === void 0 || value === null) return [];
  if (!Array.isArray(value) || value.length > 30) {
    throw new Error("An execution graph must contain at most 30 items.");
  }
  const ids = /* @__PURE__ */ new Set();
  const items = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Every execution item must be an object.");
    }
    const id = executionId(candidate.id);
    if (ids.has(id)) throw new Error(`Execution IDs collide after normalization: ${id}.`);
    ids.add(id);
    if (!Array.isArray(candidate.dependencies)) throw new Error(`Missing dependencies for ${id}.`);
    const dependencies = [...new Set(candidate.dependencies.map(executionId))];
    return { ...candidate, id, dependencies };
  });
  for (const item of items) {
    for (const dependency of item.dependencies) {
      if (dependency === item.id || !ids.has(dependency)) {
        throw new Error(`Invalid dependency ${dependency} for ${item.id}.`);
      }
    }
  }
  const complete = /* @__PURE__ */ new Set();
  while (complete.size < items.length) {
    const ready = items.filter((item) => !complete.has(item.id) && item.dependencies.every((dependency) => complete.has(dependency)));
    if (!ready.length) throw new Error("The execution dependency graph contains a cycle.");
    ready.forEach((item) => complete.add(item.id));
  }
  return items;
}
function ownershipPath(value) {
  const path = value.trim().replace(/\//g, "\\");
  if (!path || /[*?[\]{}]/.test(path)) return "*";
  if (win32.isAbsolute(path) || path.includes(":")) {
    throw new Error(`Owned paths must be workspace-relative: ${value}.`);
  }
  const trimmed = path.split("\\").map((part) => {
    const segment = part.trimEnd();
    return segment === "." || segment === ".." ? segment : segment.replace(/[ .]+$/, "");
  }).join("\\");
  const normalized = win32.normalize(trimmed).replace(/\\+$/, "").toLowerCase();
  if (normalized === ".." || normalized.startsWith("..\\")) {
    throw new Error(`Owned paths cannot escape the workspace: ${value}.`);
  }
  return normalized === "." || !normalized ? "*" : normalized;
}
function ownershipConflicts(left, right) {
  const a = left.length ? left.map(ownershipPath) : ["*"];
  const b = right.length ? right.map(ownershipPath) : ["*"];
  return a.some((x) => b.some((y) => x === "*" || y === "*" || x === y || x.startsWith(`${y}\\`) || y.startsWith(`${x}\\`)));
}
function ownershipContains(scopes, path) {
  const candidate = ownershipPath(path);
  if (candidate === "*") return false;
  return (scopes.length ? scopes : ["*"]).map(ownershipPath).some((scope) => scope === "*" || candidate === scope || candidate.startsWith(`${scope}\\`));
}

// src/execution.ts
import { createHash, randomUUID as randomUUID2 } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join as join2, resolve } from "node:path";
var ExecutionSupersededError = class extends Error {
  constructor() {
    super("This execution request is no longer active or belongs to another workspace/session.");
  }
};
var ExecutionSourceChangedError = class extends Error {
  constructor() {
    super("Workspace sources changed during testing. Previous passes are invalid; retry against the new sources.");
  }
};
var ExecutionCancellationPendingError = class extends Error {
  statusCode = 503;
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
function executionDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function executionWorkspace(root) {
  const path = resolve(root);
  return process.platform === "win32" ? path.toLowerCase() : path;
}
function newExecution(inputRevision, workspaceRoot, ownerSessionId, sourceFingerprint = null) {
  if (!ownerSessionId) throw new Error("Execution requires an owning session.");
  return {
    requestId: randomUUID2(),
    inputRevision,
    workspaceRoot: executionWorkspace(workspaceRoot),
    ownerSessionId,
    sourceFingerprint,
    runId: null,
    launchState: "unrequested",
    terminalConfirmedAt: null,
    cancellation: null
  };
}
function normalizeExecutionFields(value) {
  for (const key of ["requestId", "inputRevision", "ownerSessionId", "workspaceRoot", "sourceFingerprint", "runId"]) {
    if (value[key] !== void 0 && value[key] !== null && (typeof value[key] !== "string" || !value[key].trim() || key === "runId" && value[key].trim().length > 200)) {
      throw new Error(`Stored execution identity field ${key} is invalid.`);
    }
  }
  const text = (key) => typeof value[key] === "string" && value[key].trim() ? value[key].trim() : null;
  const cancellation = value.cancellation ?? null;
  if (cancellation && (typeof cancellation.requestId !== "string" || !cancellation.requestId || cancellation.runId !== null && typeof cancellation.runId !== "string" || typeof cancellation.requestedAt !== "string" || !cancellation.requestedAt || cancellation.confirmedAt !== null && typeof cancellation.confirmedAt !== "string" || !["cancelled", "failed"].includes(cancellation.outcome) || typeof cancellation.reason !== "string" || typeof cancellation.error !== "string")) throw new Error("Stored execution cancellation is invalid.");
  const waveManifests = value.waveManifests ?? [];
  if (!Array.isArray(waveManifests) || waveManifests.some((wave) => !wave || !Number.isInteger(wave.index) || wave.index < 1 || !Array.isArray(wave.itemIds) || wave.itemIds.some((id) => typeof id !== "string") || new Set(wave.itemIds).size !== wave.itemIds.length || !Array.isArray(wave.strategy) || wave.strategy.some((text2) => typeof text2 !== "string") || !Array.isArray(wave.handoffs) || wave.handoffs.some((text2) => typeof text2 !== "string") || !Number.isInteger(wave.maxConcurrency) || wave.maxConcurrency < 1 || wave.maxConcurrency > 30) || new Set(waveManifests.map((wave) => wave.index)).size !== waveManifests.length) {
    throw new Error("Stored execution wave manifests are invalid.");
  }
  return {
    requestId: text("requestId"),
    inputRevision: text("inputRevision"),
    ownerSessionId: text("ownerSessionId"),
    workspaceRoot: text("workspaceRoot"),
    sourceFingerprint: text("sourceFingerprint"),
    waveManifests,
    cancellation,
    terminalConfirmedAt: text("terminalConfirmedAt"),
    launchState: ["unrequested", "requested", "bound", "settled"].includes(value.launchState) ? value.launchState : "unknown"
  };
}
function executionToken(value) {
  const fields = normalizeExecutionFields(value);
  if (!fields.requestId || !fields.inputRevision || !fields.workspaceRoot || !fields.ownerSessionId) {
    throw new Error("Execution recovery requires a durable request and owner identity. Inspect the previous run before retrying.");
  }
  return {
    requestId: fields.requestId,
    inputRevision: fields.inputRevision,
    workspaceRoot: fields.workspaceRoot,
    ownerSessionId: fields.ownerSessionId,
    sourceFingerprint: fields.sourceFingerprint,
    runId: typeof value.runId === "string" ? value.runId.trim() : null
  };
}
function assertExecutionRequest(runtime, token, inputRevision, workspaceRoot, sessionId, allowUnbound = false) {
  if (!token || !token.requestId || !token.inputRevision || runtime.requestId !== token.requestId || runtime.inputRevision !== token.inputRevision || inputRevision !== token.inputRevision || runtime.ownerSessionId !== token.ownerSessionId || token.ownerSessionId !== sessionId || runtime.workspaceRoot !== token.workspaceRoot || token.workspaceRoot !== executionWorkspace(workspaceRoot) || runtime.sourceFingerprint !== token.sourceFingerprint || !allowUnbound && (!token.runId || runtime.runId !== token.runId) || allowUnbound && runtime.runId && runtime.runId !== token.runId) {
    throw new ExecutionSupersededError();
  }
}
var ignoredDirectories = /* @__PURE__ */ new Set([
  ".git",
  ".tandem",
  "node_modules",
  ".next",
  ".nuxt",
  ".cache"
]);
var rootOutputs = /* @__PURE__ */ new Set(["dist", "build", "out", "coverage", "generated"]);
async function fingerprintWorkspace(root) {
  const hash = createHash("sha256");
  async function visit(directory, prefix) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = entry.name.toLowerCase();
      if (ignoredDirectories.has(name) || !prefix && rootOutputs.has(name) || name.endsWith(".tsbuildinfo")) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join2(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, relativePath);
      } else if (entry.isSymbolicLink()) {
        throw new Error(`Cannot safely fingerprint linked source ${relativePath}; use a workspace with materialized sources.`);
      } else if (entry.isFile()) {
        const before = await lstat(path);
        hash.update(JSON.stringify([relativePath, before.size]));
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        const after = await lstat(path);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
          throw new ExecutionSourceChangedError();
        }
        hash.update("\0");
      }
    }
  }
  await visit(root, "");
  return hash.digest("hex");
}
async function assertExecutionSources(token) {
  if (!token.sourceFingerprint || await fingerprintWorkspace(token.workspaceRoot) !== token.sourceFingerprint) {
    throw new ExecutionSourceChangedError();
  }
}
function workerOutcome(value, requirements, testing = false) {
  const object = (input) => input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const result = object(value);
  const strings = (input) => Array.isArray(input) ? input.filter((item) => typeof item === "string" && !!item.trim()).map((item) => item.trim()) : [];
  const summary = typeof result.summary === "string" ? result.summary.trim() : "";
  const blockers = strings(result.blockers);
  const evidence = strings(result.evidence);
  const checks = Array.isArray(result.validation) ? result.validation.map(object) : [];
  const validation = checks.flatMap((check) => typeof check.requirement === "string" && typeof check.evidence === "string" && check.evidence.trim() ? [`${check.requirement}: ${check.status} \u2014 ${check.evidence.trim()}`] : []);
  const errors = [];
  if (!summary) errors.push("A nonempty result summary is required.");
  if (!Array.isArray(result.blockers) || result.blockers.some((item) => typeof item !== "string")) {
    errors.push("An explicit blocker list is required.");
  }
  if (blockers.length) errors.push(...blockers);
  if (testing && !evidence.length) errors.push("Passing tests require observed outcome evidence.");
  for (const requirement of requirements) {
    const matching = checks.filter((check) => check?.requirement === requirement);
    if (matching.length !== 1 || matching[0].status !== "passed" || typeof matching[0].evidence !== "string" || !matching[0].evidence.trim()) {
      errors.push(`Missing passing validation evidence for: ${requirement}`);
    }
  }
  if (!requirements.length || checks.some((check) => check?.status !== "passed")) {
    errors.push("All required validation checks must pass.");
  }
  const succeeded = result.status === (testing ? "passed" : "completed") && errors.length === 0;
  return {
    status: succeeded ? testing ? "passed" : "completed" : "failed",
    summary: succeeded ? summary : [summary || "Worker returned no valid result.", ...errors].join(" "),
    validation,
    evidence: [...evidence, ...validation],
    filesChanged: strings(result.filesChanged),
    blockers: succeeded ? [] : errors.length ? errors : ["Worker reported failure."]
  };
}

// src/canvas-transport.ts
async function readJsonRequest(request, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error("Request is too large.");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object.");
  }
  return Object.fromEntries(Object.entries(value));
}
function sendJsonResponse(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(value));
}

// src/workflow.ts
var lifecycleStages = [
  { id: "prepare", label: "Preparation" },
  { id: "requirements", label: "Requirements" },
  { id: "prototype", label: "Prototype" },
  { id: "design", label: "Design" },
  { id: "plan", label: "Plan" },
  { id: "implement", label: "Implement" },
  { id: "test", label: "Test" }
];
function hasUnconfirmedExecution(value) {
  return Boolean(value?.cancellation && !value.cancellation.confirmedAt) || Boolean(value && !value.terminalConfirmedAt && (value.status === "cancelled" || value.status === "failed" && value.runId));
}
function hasActiveWork(state) {
  const reviewActive = (review) => Boolean(review?.processing || review?.finalizeRequested || review?.threads?.some((thread) => thread.status === "queued" || thread.status === "processing"));
  return ["starting", "running"].includes(state.preparation?.status || "") || state.processing?.status === "running" || state.suggestionProcessing?.status === "running" || reviewActive(state.designReview) || reviewActive(state.testDesignReview) || Boolean(state.planning?.processing) || hasUnconfirmedExecution(state.implementation) || hasUnconfirmedExecution(state.testing) || ["starting", "running"].includes(state.implementation?.status || "") || ["starting", "running"].includes(state.testing?.status || "");
}
function reopenTestLifecycle(lifecycle) {
  return {
    ...lifecycle,
    currentStage: "test",
    completedStages: lifecycle.completedStages.filter((stage) => stage !== "test"),
    outputs: lifecycle.outputs.filter((output) => output.stageId !== "test"),
    history: [...lifecycle.history, ...lifecycle.outputs.filter((output) => output.stageId === "test")]
  };
}
function sameOwner(left, right) {
  const canonical2 = (path) => {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
  };
  return left?.sessionId === right.sessionId && canonical2(left.workspaceRoot) === canonical2(right.workspaceRoot);
}
function invalidateArtifacts(artifacts, stageId) {
  const index = lifecycleStages.findIndex((stage) => stage.id === stageId);
  return artifacts.map((artifact) => lifecycleStages.findIndex((stage) => stage.id === artifact.stage) >= index ? { ...artifact, reviewStatus: "stale" } : artifact);
}
function normalizeDecisionId(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}
function validateDecisionGraph(graph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length) throw new Error("Decision IDs must be unique.");
  const visited = /* @__PURE__ */ new Set();
  const visiting = /* @__PURE__ */ new Set();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const visit = (id) => {
    if (visiting.has(id)) throw new Error("The requirements graph contains a dependency cycle.");
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node) throw new Error(`Unknown decision dependency "${id}".`);
    visiting.add(id);
    for (const dependency of node.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}
function decisionDescendants(graph, id) {
  const descendants = /* @__PURE__ */ new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (node.id !== id && !descendants.has(node.id) && node.dependencies.some((dependency) => dependency === id || descendants.has(dependency))) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  return descendants;
}
function applyAuthoritativeAnswer(current, proposed, questionId, answer, changingAnswer) {
  validateDecisionGraph(proposed);
  if (!current.nodes.some((node) => node.id === questionId) || !proposed.nodes.some((node) => node.id === questionId)) {
    throw new Error("The worker omitted the decision being answered.");
  }
  const descendants = decisionDescendants(current, questionId);
  const oldNodes = new Map(current.nodes.map((node) => [node.id, node]));
  for (const old of current.nodes) {
    if (!proposed.nodes.some((node) => node.id === old.id)) {
      throw new Error(`The worker removed existing decision "${old.id}". Reopen the requirements explicitly to revise scope.`);
    }
  }
  const nodes = proposed.nodes.map((node) => {
    const old = oldNodes.get(node.id);
    if (node.id === questionId) return { ...old, answer };
    if ((!old || descendants.has(node.id)) && !node.question) {
      throw new Error(`The worker omitted the question for decision "${node.id}".`);
    }
    if (changingAnswer && descendants.has(node.id)) return { ...node, answer: null };
    if ((node.answer || null) !== (old?.answer || null)) {
      throw new Error(`The worker changed an answer the user did not submit: "${node.id}".`);
    }
    if (old?.answer && JSON.stringify(node.dependencies) !== JSON.stringify(old.dependencies)) {
      throw new Error(`The worker changed prerequisites for confirmed decision "${node.id}".`);
    }
    return old && !descendants.has(node.id) ? { ...old } : { ...node, answer: old?.answer || null };
  });
  validateDecisionGraph({ nodes });
  return { nodes };
}

// src/extension.ts
var CANVAS_ID = "tandem";
var DEFAULT_PROTOTYPE_ID = "active";
var USER_EXTENSION_ID = "user:tandem";
var PROJECT_EXTENSION_ID = "project:tandem";
var MAX_REQUEST_BYTES = 32 * 1024;
var PROCESS_STARTED_AT = Date.now();
var WORKSPACE_ROOT = process.cwd();
var SHARED_PROJECT_ROOT = resolveSharedProjectRoot();
var STATE_DIRECTORY = join3(SHARED_PROJECT_ROOT, ".tandem");
var CURRENT_STATE_PATH = join3(STATE_DIRECTORY, "current.json");
var LEGACY_STATE_DIRECTORY = join3(
  SHARED_PROJECT_ROOT,
  [".intent", "studio"].join("")
);
var LEGACY_CURRENT_STATE_PATH = join3(LEGACY_STATE_DIRECTORY, "current.json");
var PREVIEW_IDENTITY_MARKERS = /* @__PURE__ */ new Set([
  "tandem-prototype-id",
  ["fast", "prototype", "id"].join("-")
]);
var LIFECYCLE_STAGES = lifecycleStages;
var PROVIDER_SCOPE = providerScopeFromModuleUrl(import.meta.url);
var ANSWER_FACTORY_NAME = `tandem-process-answer-${PROVIDER_SCOPE}`;
var PREPARATION_FACTORY_NAME = `tandem-prepare-environment-${PROVIDER_SCOPE}`;
var SUGGESTION_FACTORY_NAME = `tandem-generate-usage-suggestions-${PROVIDER_SCOPE}`;
var DESIGN_REVIEW_FACTORY_NAME = `tandem-design-review-${PROVIDER_SCOPE}`;
var PLANNING_FACTORY_NAME = `tandem-execution-planning-${PROVIDER_SCOPE}`;
var IMPLEMENTATION_FACTORY_NAME = `tandem-implementation-orchestrator-${PROVIDER_SCOPE}`;
var TEST_FACTORY_NAME = `tandem-integration-interaction-tests-${PROVIDER_SCOPE}`;
var USAGE_QUESTION_ID = "usage-intake";
var ANSWER_ACTIONS = /* @__PURE__ */ new Set([
  "add-usage",
  "generate-dag",
  "answer-decision",
  "change-answer",
  "submit-revision",
  "clarify-revision",
  "generate-design-spec",
  "build-prototype"
]);
var PROCESSING_MESSAGES = {
  "build-prototype": "Building the initial runnable prototype from the accepted requirements.",
  "add-usage": "Saving the usage and generating complementary suggestions.",
  "generate-dag": "Analyzing usages and building the dependency-aware requirements DAG.",
  "answer-decision": "Recording the answer and recomputing dependent decisions.",
  "change-answer": "Regenerating every downstream decision affected by this answer.",
  "submit-revision": "Reviewing the requested prototype behavior and interaction changes.",
  "clarify-revision": "Applying the clarification to the active prototype revision.",
  "generate-design-spec": "Synthesizing confirmed requirements and prototype evidence."
};
var DEFAULT_PRODUCT_DESIGN_REQUESTS = [
  {
    id: "default-project-architecture",
    artifactKind: "diagram",
    prompt: "Inspect this project and generate the architecture and primary interaction-flow diagrams required for implementation. Tailor them to the accepted requirements, applicable runnable interface, draft feature specification, and existing repository; omit diagrams that do not add value for this project."
  },
  {
    id: "default-project-contracts",
    artifactKind: "contract",
    prompt: "Inspect this project and generate the implementation-facing UI, state, data, and integration contracts it actually requires. Capture boundaries, inputs and outputs, events, validation, and failure behavior without inventing unnecessary infrastructure."
  },
  {
    id: "default-project-decisions",
    artifactKind: "decision-record",
    prompt: "Inspect this project and record its implementation-critical design decisions, alternatives, tradeoffs, and risks. Include only decisions that should be reviewed before execution planning."
  }
];
var PROVIDER_EXTENSION_ID = PROVIDER_SCOPE === "user" ? USER_EXTENSION_ID : PROVIDER_SCOPE === "project" ? PROJECT_EXTENSION_ID : `session:tandem`;
var servers = /* @__PURE__ */ new Map();
var instancePrototypeIds = /* @__PURE__ */ new Map();
var stateCache = /* @__PURE__ */ new Map();
var activeAnswerRuns = /* @__PURE__ */ new Map();
var activePreparationRuns = /* @__PURE__ */ new Map();
var activeSuggestionRuns = /* @__PURE__ */ new Map();
var activeDesignReviewRuns = /* @__PURE__ */ new Map();
var activePlanningRuns = /* @__PURE__ */ new Map();
var activeImplementationRuns = /* @__PURE__ */ new Map();
var activeTestRuns = /* @__PURE__ */ new Map();
var activePrototypeCompletions = /* @__PURE__ */ new Set();
var projectStore = new ProjectStore({
  root: STATE_DIRECTORY,
  create: createState,
  normalize: normalizeStoredState,
  legacyPaths: legacyStateFilePaths
});
var session;
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
var AnswerRequestError = class extends Error {
  statusCode;
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
};
async function logSafely(message, level = "error") {
  try {
    await session.log(message, { level });
  } catch (error) {
    console.error(
      `${message} Logging also failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function resolveSharedProjectRoot() {
  const cwd = process.cwd();
  const options = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  };
  try {
    const commonValue = execFileSync(
      "git",
      ["rev-parse", "--git-common-dir"],
      options
    ).trim();
    const commonDirectory = resolve2(cwd, commonValue);
    if (basename(commonDirectory).toLowerCase() === ".git") {
      return dirname2(commonDirectory);
    }
    return execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      options
    ).trim() || cwd;
  } catch {
    return cwd;
  }
}
function providerScopeFromModuleUrl(moduleUrl) {
  const normalized = moduleUrl.toLowerCase();
  if (normalized.includes("/.github/extensions/")) return "project";
  if (normalized.includes("/.copilot/extensions/")) return "user";
  return "session";
}
function normalizePrototypeId(value) {
  return normalizeProjectId(value || DEFAULT_PROTOTYPE_ID);
}
function normalizePrototypeApproach(value) {
  const mode = isObject(value) && ["undecided", "build", "validate-existing", "not-applicable"].includes(
    value.mode
  ) ? value.mode : "undecided";
  const defaultReason = {
    undecided: "Requirements must determine whether graphical validation adds value.",
    build: "A new graphical interface is needed to validate the primary flow.",
    "validate-existing": "The existing graphical interface will be used for prototype validation.",
    "not-applicable": "This work has no graphical interface to prototype or review."
  }[mode];
  return {
    mode,
    reason: String(isObject(value) ? value.reason || "" : "").trim().slice(0, 500) || defaultReason
  };
}
function normalizeSourceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href.slice(0, 1e3) : "";
  } catch {
    return "";
  }
}
function preparationWorkItems() {
  return [
    {
      id: "workspace",
      title: "Inspect workspace",
      status: "pending",
      detail: "Identify repository structure, guidance, runtimes, and execution constraints.",
      result: ""
    },
    {
      id: "sources",
      title: "Analyze authoritative sources",
      status: "pending",
      detail: "Ground named products, methods, and benchmarks in primary sources.",
      result: ""
    },
    {
      id: "requirements-handoff",
      title: "Prepare requirements handoff",
      status: "pending",
      detail: "Synthesize usages, assumptions, deferred work, and prototype guidance.",
      result: ""
    }
  ];
}
function normalizePreparation(value) {
  const status = isObject(value) && [
    "not-started",
    "starting",
    "running",
    "ready",
    "needs-attention",
    "failed"
  ].includes(value.status) ? value.status : "not-started";
  const workItems = isObject(value) && Array.isArray(value.workItems) ? value.workItems.filter((entry) => isObject(entry)).map((entry, index) => ({
    id: String(entry.id || `preparation-${index + 1}`).trim().slice(0, 120),
    title: String(entry.title || "Preparation work").trim().slice(0, 160),
    status: [
      "pending",
      "running",
      "completed",
      "failed"
    ].includes(entry.status) ? entry.status : "pending",
    detail: String(entry.detail || "").trim().slice(0, 1e3),
    result: String(entry.result || "").trim().slice(0, 4e3)
  })).filter((entry) => entry.id && entry.title).slice(0, 20) : [];
  const messages = isObject(value) && Array.isArray(value.messages) ? value.messages.filter((entry) => isObject(entry)).map((entry, index) => ({
    id: String(entry.id || `preparation-message-${index + 1}`).trim().slice(0, 120),
    text: String(entry.text || "").trim().slice(0, 2e3),
    kind: ["info", "success", "warning", "error"].includes(
      entry.kind
    ) ? entry.kind : "info",
    at: String(entry.at || "")
  })).filter((entry) => entry.text).slice(-100) : [];
  const checks = isObject(value) && Array.isArray(value.checks) ? value.checks.filter((entry) => isObject(entry)).map((entry) => ({
    label: String(entry.label || "").trim().slice(0, 120),
    status: ["ready", "missing", "deferred"].includes(
      entry.status
    ) ? entry.status : "missing",
    detail: String(entry.detail || "").trim().slice(0, 500)
  })).filter((entry) => entry.label).slice(0, 20) : [];
  const sources = isObject(value) && Array.isArray(value.sources) ? value.sources.filter((entry) => isObject(entry)).map((entry) => ({
    title: String(entry.title || "").trim().slice(0, 160),
    url: normalizeSourceUrl(entry.url),
    purpose: String(entry.purpose || "").trim().slice(0, 500)
  })).filter((entry) => entry.title && entry.url).slice(0, 20) : [];
  return {
    status,
    summary: String(isObject(value) ? value.summary || "" : "").trim().slice(0, 2e3),
    workItems: workItems.length > 0 || ["ready", "needs-attention", "failed"].includes(status) ? workItems : preparationWorkItems(),
    messages,
    checks,
    sources,
    suggestedUsages: normalizeStringList(
      isObject(value) ? value.suggestedUsages : []
    ).map((item) => item.slice(0, 500)).slice(0, 6),
    processing: isObject(value) && isObject(value.processing) ? {
      requestId: typeof value.processing.requestId === "string" ? value.processing.requestId : null,
      generation: typeof value.processing.generation === "string" ? value.processing.generation : null,
      runId: value.processing.runId ? String(value.processing.runId).slice(0, 200) : null,
      requestedAt: String(value.processing.requestedAt || ""),
      completedAt: value.processing.completedAt ? String(value.processing.completedAt) : null
    } : null,
    error: String(isObject(value) ? value.error || "" : "").trim().slice(0, 4e3)
  };
}
function createState(prototypeId, goal = "") {
  return {
    version: 1,
    revision: 0,
    generation: randomUUID3(),
    jobOwner: null,
    openResetRequestId: null,
    prototypeId,
    stage: "prepare",
    lifecycle: {
      currentStage: "prepare",
      completedStages: [],
      outputs: [],
      skippedStages: [],
      history: []
    },
    goal,
    phase: "building",
    status: "Preparing the workspace and analyzing the goal...",
    preparation: normalizePreparation(null),
    prototypeApproach: normalizePrototypeApproach(null),
    requirements: {
      substage: "usage",
      usageItems: [],
      suggestions: []
    },
    question: usageQuestion([]),
    decisionGraph: { nodes: [] },
    confirmed: [],
    assumed: [],
    deferred: [],
    artifacts: [],
    previewUrl: null,
    previewStatus: "waiting",
    prototypeReview: {
      revisions: [],
      activeRevisionId: null,
      question: null,
      evidence: [],
      designSpecArtifactId: null
    },
    designReview: {
      threads: [],
      processing: null,
      finalizeRequested: false,
      finalizedArtifactId: null
    },
    design: {
      substage: "product"
    },
    testDesignReview: {
      threads: [],
      processing: null,
      finalizeRequested: false,
      finalizedArtifactId: null,
      scenarios: []
    },
    planning: {
      status: "idle",
      summary: "",
      strategy: "",
      maxAgents: 4,
      workItems: [],
      waves: [],
      agents: [],
      risks: [],
      revisionHistory: [],
      metrics: {
        totalEffortHours: 0,
        scheduledHours: 0,
        criticalPathHours: 0,
        parallelismSavingsHours: 0,
        maxParallelism: 0
      },
      processing: null,
      finalizedArtifactId: null,
      error: ""
    },
    implementation: {
      status: "idle",
      runId: null,
      currentWaveIndex: 0,
      workItems: [],
      agents: [],
      strategySuggestions: [],
      events: [],
      startedAt: null,
      completedAt: null,
      finalizedArtifactId: null,
      error: ""
    },
    testing: {
      status: "idle",
      runId: null,
      currentWaveIndex: 0,
      scenarios: [],
      agents: [],
      events: [],
      startedAt: null,
      completedAt: null,
      finalizedArtifactId: null,
      error: ""
    },
    processing: null,
    suggestionProcessing: null,
    reloadReceipt: null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function legacyStateFilePaths(prototypeId) {
  const fileName = `${normalizePrototypeId(prototypeId)}.json`;
  const paths = [join3(STATE_DIRECTORY, fileName), join3(LEGACY_STATE_DIRECTORY, fileName)];
  if (session?.workspacePath) {
    paths.push(
      join3(session.workspacePath, "files", "tandem", fileName),
      join3(
        session.workspacePath,
        "files",
        ["fast", "prototyping"].join("-"),
        fileName
      )
    );
  }
  return paths;
}
async function loadCurrentPrototypeId() {
  return projectStore.current([CURRENT_STATE_PATH, LEGACY_CURRENT_STATE_PATH]);
}
async function persistCurrentPrototypeId(prototypeId) {
  await projectStore.setCurrent(prototypeId);
}
function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 50);
}
function inferArtifactStage(artifact, fallbackStage = "requirements") {
  if (LIFECYCLE_STAGES.some((stage) => stage.id === artifact.stage)) {
    return artifact.stage;
  }
  const id = String(artifact.id || "").toLowerCase();
  const kind = String(artifact.kind || "").toLowerCase();
  if (id === "draft-feature-spec" || ["feature-spec", "prototype", "prototype-evidence"].includes(kind)) {
    return "prototype";
  }
  if (id === "design-review" || id === "design-spec" || id === "test-spec" || [
    "design-review",
    "design-spec",
    "test-spec",
    "test-scenario",
    "architecture",
    "contract"
  ].includes(kind)) {
    return "design";
  }
  if (id === "implementation-plan" || ["implementation-plan", "execution-plan"].includes(kind)) {
    return "plan";
  }
  if (id === "final-code" || ["final-code", "implementation-result", "code"].includes(kind)) {
    return "implement";
  }
  if (id === "test-results" || ["test-results", "integration-test-results", "interaction-test-results"].includes(
    kind
  )) {
    return "test";
  }
  if (id === "user-intents" || id === "design-tree" || ["intent", "requirements", "data-model", "interaction-flow"].includes(kind)) {
    return "requirements";
  }
  return LIFECYCLE_STAGES.some((stage) => stage.id === fallbackStage) ? fallbackStage : "requirements";
}
function normalizeRequirements(value, decisionGraph = { nodes: [] }) {
  const fallbackSubstage = Array.isArray(decisionGraph.nodes) && decisionGraph.nodes.length > 0 ? "dag" : "usage";
  const substage = isObject(value) && ["usage", "dag"].includes(value.substage) ? value.substage : fallbackSubstage;
  const usageItems = normalizeStringList(
    isObject(value) ? value.usageItems : []
  ).map((item) => item.slice(0, 500)).slice(0, 30);
  const normalizedUsage = new Set(usageItems.map((item) => item.toLowerCase()));
  const suggestions = normalizeStringList(
    isObject(value) ? value.suggestions : []
  ).map((item) => item.slice(0, 500)).filter((item) => !normalizedUsage.has(item.toLowerCase())).slice(0, 6);
  return { substage, usageItems, suggestions };
}
function usageQuestion(suggestions) {
  return {
    id: USAGE_QUESTION_ID,
    text: "How do you want to use this deliverable?",
    rationale: "Add one sentence for each usage. Suggestions adapt as you add more.",
    choices: normalizeStringList(suggestions).slice(0, 6),
    recommended: null,
    allowFreeText: true,
    answerPlaceholder: "For example: I want to run one reproducible evaluation."
  };
}
function normalizeArtifacts(value, fallbackStage = "requirements") {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((artifact, index) => {
    if (!isObject(artifact)) return null;
    const path = String(artifact.path || "").trim().slice(0, 500);
    const id = String(artifact.id || path || `artifact-${index + 1}`).trim().slice(0, 120);
    const title = String(artifact.title || path || id).trim().slice(0, 200);
    if (!id || !title) return null;
    const kind = String(artifact.kind || "artifact").trim().slice(0, 80);
    const stage = inferArtifactStage(artifact, fallbackStage);
    return {
      id,
      title,
      kind,
      stage,
      path: !path && stage === "implement" && (id === "final-code" || kind === "final-code") ? "." : path,
      language: String(artifact.language || "markdown").trim().slice(0, 80),
      content: String(artifact.content || "").slice(0, 2e5),
      mermaid: String(artifact.mermaid || "").trim().slice(0, 5e4),
      sourceThreadIds: normalizeStringList(
        artifact.sourceThreadIds
      ).slice(0, 50),
      reviewStatus: ["current", "stale"].includes(
        artifact.reviewStatus
      ) ? artifact.reviewStatus : "current",
      sourceRevision: Number.isSafeInteger(artifact.sourceRevision) ? artifact.sourceRevision : void 0
    };
  }).filter(Boolean);
}
function normalizeTestScenarios(value) {
  const scenarios = [];
  for (const candidate of executionGraph(value)) {
    const id = candidate.id;
    const title = String(candidate.title || "").trim().slice(0, 300);
    const description = String(candidate.description || "").trim().slice(0, 4e3);
    if (!title || !description || !normalizeStringList(candidate.steps).length || !String(candidate.expectedOutcome || "").trim() || !normalizeStringList(candidate.validation).length) {
      throw new Error(`Test scenario ${id} requires a title, description, steps, expected outcome, and validation.`);
    }
    scenarios.push({
      id,
      title,
      type: ["integration", "interaction"].includes(candidate.type) ? candidate.type : "interaction",
      description,
      dependencies: candidate.dependencies,
      steps: normalizeStringList(candidate.steps).slice(0, 30),
      expectedOutcome: String(candidate.expectedOutcome || "").trim().slice(0, 4e3),
      validation: normalizeStringList(candidate.validation).slice(0, 30)
    });
  }
  return scenarios;
}
function normalizeDesignReview(value) {
  const threads = isObject(value) && Array.isArray(value.threads) ? value.threads.slice(-100).map((thread, index) => {
    if (!isObject(thread)) return null;
    const id = String(thread.id || `design-thread-${index + 1}`).trim().slice(0, 120);
    const prompt = String(thread.prompt || "").trim().slice(0, 4e3);
    if (!id || !prompt) return null;
    const type = ["question", "artifact"].includes(thread.type) ? thread.type : "question";
    return {
      id,
      type,
      artifactKind: [
        "diagram",
        "contract",
        "decision-record",
        "test-scenario"
      ].includes(thread.artifactKind) ? thread.artifactKind : null,
      prompt,
      answer: String(thread.answer || "").trim().slice(0, 2e4),
      status: [
        "queued",
        "processing",
        "answered",
        "resolved",
        "failed"
      ].includes(thread.status) ? thread.status : "queued",
      artifactIds: normalizeStringList(thread.artifactIds).slice(
        0,
        20
      ),
      reviewArtifactId: typeof thread.reviewArtifactId === "string" ? thread.reviewArtifactId.trim().slice(0, 120) || null : null,
      createdAt: String(thread.createdAt || ""),
      completedAt: thread.completedAt ? String(thread.completedAt) : null,
      error: String(thread.error || "").trim().slice(0, 1e3)
    };
  }).filter(Boolean) : [];
  const threadIds = new Set(threads.map((thread) => thread.id));
  const processing = isObject(value) && isObject(value.processing) && typeof value.processing.requestId === "string" ? {
    requestId: value.processing.requestId.trim().slice(0, 120),
    action: value.processing.action === "finalize" ? "finalize" : "process-thread",
    threadId: threadIds.has(value.processing.threadId) ? value.processing.threadId : null,
    runId: value.processing.runId ? String(value.processing.runId).trim().slice(0, 200) : null,
    requestedAt: String(value.processing.requestedAt || "")
  } : null;
  return {
    threads,
    processing: processing?.requestId && (processing.action === "finalize" || processing.threadId) ? processing : null,
    finalizeRequested: isObject(value) && value.finalizeRequested === true,
    finalizedArtifactId: isObject(value) && typeof value.finalizedArtifactId === "string" ? value.finalizedArtifactId.trim().slice(0, 120) || null : null,
    scenarios: normalizeTestScenarios(
      isObject(value) ? value.scenarios : []
    )
  };
}
function normalizeDesign(value, designReview) {
  const productComplete = ["design-spec", "design-review"].includes(
    designReview.finalizedArtifactId
  );
  return {
    substage: isObject(value) && ["product", "test"].includes(value.substage) ? value.substage : productComplete ? "test" : "product"
  };
}
function scheduleTestScenarios(scenarios, maxAgents = 4) {
  if (!Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > 30) throw new Error("Invalid test concurrency.");
  const scheduled = /* @__PURE__ */ new Set();
  const remaining = new Set(scenarios.map((scenario) => scenario.id));
  const waves = [];
  while (remaining.size > 0) {
    const ready = scenarios.filter(
      (scenario) => remaining.has(scenario.id) && scenario.dependencies.every(
        (dependency) => scheduled.has(dependency)
      )
    );
    if (ready.length === 0) {
      return {
        waves: [],
        error: "The test scenario dependency graph contains a cycle."
      };
    }
    const batch = ready.slice(0, maxAgents);
    waves.push({
      index: waves.length + 1,
      scenarioIds: batch.map((scenario) => scenario.id)
    });
    for (const scenario of batch) {
      remaining.delete(scenario.id);
      scheduled.add(scenario.id);
    }
  }
  return { waves, error: "" };
}
function normalizeTesting(value, testDesignReview) {
  const source = isObject(value) ? value : {};
  const runtimeById = new Map(
    (Array.isArray(source.scenarios) ? source.scenarios : []).filter((scenario) => isObject(scenario)).map((scenario) => [String(scenario.id || ""), scenario])
  );
  const scenarios = testDesignReview.scenarios.map((spec) => {
    const runtime = runtimeById.get(spec.id) || {};
    return {
      id: spec.id,
      status: ["pending", "running", "passed", "failed", "blocked"].includes(
        runtime.status
      ) ? runtime.status : "pending",
      summary: String(runtime.summary || "").trim().slice(0, 12e3),
      evidence: normalizeStringList(runtime.evidence).slice(0, 50),
      startedAt: runtime.startedAt ? String(runtime.startedAt) : null,
      completedAt: runtime.completedAt ? String(runtime.completedAt) : null
    };
  });
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const agents = (Array.isArray(source.agents) ? source.agents : []).slice(0, 30).map((agent) => {
    if (!isObject(agent)) return null;
    const scenarioId = String(agent.scenarioId || "").trim().slice(0, 120);
    if (!scenarioIds.has(scenarioId)) return null;
    return {
      id: String(agent.id || `test:${scenarioId}`).trim().slice(0, 120),
      scenarioId,
      status: String(agent.status || "pending").trim().slice(0, 80),
      activity: String(agent.activity || "").trim().slice(0, 1e3),
      summary: String(agent.summary || "").trim().slice(0, 8e3)
    };
  }).filter(Boolean);
  const events = (Array.isArray(source.events) ? source.events : []).slice(-200).map((event, index) => {
    if (!isObject(event)) return null;
    const message = String(event.message || "").trim().slice(0, 2e3);
    if (!message) return null;
    return {
      id: String(event.id || `test-event-${index + 1}`).trim().slice(0, 120),
      type: String(event.type || "info").trim().slice(0, 80),
      message,
      at: String(event.at || "")
    };
  }).filter(Boolean);
  return {
    ...normalizeExecutionFields(source),
    status: ["idle", "starting", "running", "completed", "failed"].includes(
      source.status
    ) ? source.status : "idle",
    runId: typeof source.runId === "string" ? source.runId.trim().slice(0, 200) || null : null,
    currentWaveIndex: Math.max(
      0,
      Number.parseInt(source.currentWaveIndex, 10) || 0
    ),
    scenarios,
    agents,
    events,
    startedAt: source.startedAt ? String(source.startedAt) : null,
    completedAt: source.completedAt ? String(source.completedAt) : null,
    finalizedArtifactId: typeof source.finalizedArtifactId === "string" ? source.finalizedArtifactId.trim().slice(0, 120) || null : null,
    error: String(source.error || "").trim().slice(0, 2e3),
    errorDetails: String(source.errorDetails || "").trim().slice(0, 5e4)
  };
}
function normalizePlanWorkItems(value) {
  const items = [];
  for (const candidate of executionGraph(value)) {
    const id = candidate.id;
    const title = String(candidate.title || "").trim().slice(0, 200);
    const description = String(candidate.description || "").trim().slice(0, 4e3);
    if (!title || !description || !normalizeStringList(candidate.acceptanceCriteria).length || !normalizeStringList(candidate.validation).length) {
      throw new Error(`Work item ${id} requires a title, description, acceptance criteria, and validation.`);
    }
    normalizeStringList(candidate.files).forEach(ownershipPath);
    items.push({
      id,
      title,
      description,
      dependencies: candidate.dependencies,
      agentRole: String(candidate.agentRole || "Implementation engineer").trim().slice(0, 120) || "Implementation engineer",
      agentId: String(candidate.agentId || "").trim().slice(0, 80),
      estimatedHours: Math.max(
        0.5,
        Math.min(80, Number(candidate.estimatedHours) || 1)
      ),
      files: normalizeStringList(candidate.files).map((path) => path.slice(0, 500)).slice(0, 50),
      skills: normalizeStringList(candidate.skills).map((skill) => skill.slice(0, 120)).slice(0, 20),
      acceptanceCriteria: normalizeStringList(candidate.acceptanceCriteria).map((criterion) => criterion.slice(0, 1e3)).slice(0, 30),
      validation: normalizeStringList(candidate.validation).map((step) => step.slice(0, 1e3)).slice(0, 20)
    });
  }
  return items;
}
function schedulePlanWorkItems(workItems, maxAgents) {
  if (!Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > 30) throw new Error("Invalid implementation concurrency.");
  const itemMap = new Map(
    workItems.map((item) => [item.id, { ...item, agentId: "" }])
  );
  const remaining = new Set(itemMap.keys());
  const completed = /* @__PURE__ */ new Set();
  const waves = [];
  const agents = /* @__PURE__ */ new Map();
  let startHour = 0;
  while (remaining.size > 0) {
    const ready = [...remaining].map((id) => itemMap.get(id)).filter(
      (item) => item.dependencies.every((dependency) => completed.has(dependency))
    ).sort(
      (left, right) => right.estimatedHours - left.estimatedHours || left.id.localeCompare(right.id)
    );
    if (ready.length === 0) {
      throw new Error("The execution plan contains a dependency cycle.");
    }
    const selected = [];
    for (const item of ready) {
      if (selected.length >= maxAgents) break;
      const conflicts = selected.some((other) => ownershipConflicts(item.files, other.files));
      if (conflicts) continue;
      selected.push(item);
    }
    if (selected.length === 0) selected.push(ready[0]);
    selected.forEach((item, index) => {
      const agentId = `agent-${index + 1}`;
      item.agentId = agentId;
      const current = agents.get(agentId) || {
        id: agentId,
        workItemIds: [],
        roles: [],
        estimatedHours: 0
      };
      current.workItemIds.push(item.id);
      if (!current.roles.includes(item.agentRole)) {
        current.roles.push(item.agentRole);
      }
      current.estimatedHours += item.estimatedHours;
      agents.set(agentId, current);
    });
    const durationHours = Math.max(
      ...selected.map((item) => item.estimatedHours)
    );
    waves.push({
      id: `wave-${waves.length + 1}`,
      index: waves.length + 1,
      workItemIds: selected.map((item) => item.id),
      startHour,
      endHour: startHour + durationHours,
      durationHours
    });
    startHour += durationHours;
    for (const item of selected) {
      remaining.delete(item.id);
      completed.add(item.id);
    }
  }
  const orderedItems = waves.flatMap(
    (wave) => wave.workItemIds.map((id) => itemMap.get(id))
  );
  const criticalFinish = /* @__PURE__ */ new Map();
  for (const item of orderedItems) {
    const dependencyFinish = item.dependencies.length > 0 ? Math.max(
      ...item.dependencies.map(
        (dependency) => criticalFinish.get(dependency) || 0
      )
    ) : 0;
    criticalFinish.set(
      item.id,
      dependencyFinish + item.estimatedHours
    );
  }
  const totalEffortHours = orderedItems.reduce(
    (total, item) => total + item.estimatedHours,
    0
  );
  const criticalPathHours = criticalFinish.size > 0 ? Math.max(...criticalFinish.values()) : 0;
  return {
    workItems: orderedItems,
    waves,
    agents: [...agents.values()],
    metrics: {
      totalEffortHours,
      scheduledHours: startHour,
      criticalPathHours,
      parallelismSavingsHours: Math.max(0, totalEffortHours - startHour),
      maxParallelism: waves.length > 0 ? Math.max(...waves.map((wave) => wave.workItemIds.length)) : 0
    }
  };
}
function normalizePlanning(value) {
  const source = isObject(value) ? value : {};
  const maxAgents = Math.max(
    1,
    Math.min(30, Number.parseInt(source.maxAgents, 10) || 4)
  );
  const rawItems = normalizePlanWorkItems(source.workItems);
  let schedule = {
    workItems: rawItems,
    waves: [],
    agents: [],
    metrics: {
      totalEffortHours: 0,
      scheduledHours: 0,
      criticalPathHours: 0,
      parallelismSavingsHours: 0,
      maxParallelism: 0
    }
  };
  let scheduleError = "";
  try {
    schedule = schedulePlanWorkItems(rawItems, maxAgents);
  } catch (error) {
    scheduleError = error instanceof Error ? error.message : String(error);
  }
  const processing = isObject(source.processing) && typeof source.processing.requestId === "string" && source.processing.requestId.trim() ? {
    requestId: source.processing.requestId.trim().slice(0, 120),
    action: source.processing.action === "revise" ? "revise" : "generate",
    instruction: String(source.processing.instruction || "").trim().slice(0, 4e3),
    runId: source.processing.runId ? String(source.processing.runId).trim().slice(0, 200) : null,
    requestedAt: String(source.processing.requestedAt || "")
  } : null;
  return {
    status: [
      "idle",
      "generating",
      "revising",
      "ready",
      "complete",
      "failed"
    ].includes(source.status) ? source.status : rawItems.length > 0 ? "ready" : "idle",
    summary: String(source.summary || "").trim().slice(0, 8e3),
    strategy: String(source.strategy || "").trim().slice(0, 8e3),
    maxAgents,
    ...schedule,
    risks: normalizeStringList(source.risks).map((risk) => risk.slice(0, 1e3)).slice(0, 50),
    revisionHistory: normalizeStringList(source.revisionHistory).map((entry) => entry.slice(0, 4e3)).slice(-30),
    processing,
    finalizedArtifactId: typeof source.finalizedArtifactId === "string" ? source.finalizedArtifactId.trim().slice(0, 120) || null : null,
    error: (scheduleError || String(source.error || "").trim()).slice(
      0,
      1e3
    )
  };
}
function normalizeImplementation(value, planning) {
  const source = isObject(value) ? value : {};
  const planItemIds = new Set(planning.workItems.map((item) => item.id));
  const rawWorkItems = Array.isArray(source.workItems) ? source.workItems : [];
  const runtimeById = new Map(
    rawWorkItems.filter(
      (item) => isObject(item) && planItemIds.has(String(item.id || ""))
    ).map((item) => [String(item.id), item])
  );
  const workItems = planning.workItems.map((planItem) => {
    const runtime = runtimeById.get(planItem.id) || {};
    return {
      id: planItem.id,
      status: [
        "pending",
        "running",
        "completed",
        "failed",
        "blocked",
        "cancelled"
      ].includes(runtime.status) ? runtime.status : "pending",
      agentId: String(runtime.agentId || planItem.agentId || "").trim().slice(0, 120),
      summary: String(runtime.summary || "").trim().slice(0, 12e3),
      filesChanged: normalizeStringList(runtime.filesChanged).map((path) => path.slice(0, 500)).slice(0, 100),
      validation: normalizeStringList(runtime.validation).map((entry) => entry.slice(0, 2e3)).slice(0, 50),
      blockers: normalizeStringList(runtime.blockers).map((entry) => entry.slice(0, 2e3)).slice(0, 50),
      startedAt: runtime.startedAt ? String(runtime.startedAt) : null,
      completedAt: runtime.completedAt ? String(runtime.completedAt) : null
    };
  });
  const agents = Array.isArray(source.agents) ? source.agents.slice(0, 100).map((agent) => {
    if (!isObject(agent)) return null;
    const id = String(agent.id || "").trim().slice(0, 120);
    const workItemId = String(agent.workItemId || "").trim().slice(0, 120);
    if (!id || !planItemIds.has(workItemId)) return null;
    return {
      id,
      workItemId,
      role: String(agent.role || "").trim().slice(0, 120),
      status: String(agent.status || "pending").trim().slice(0, 80),
      activity: String(agent.activity || "").trim().slice(0, 1e3),
      activeMs: Math.max(0, Number(agent.activeMs) || 0),
      model: String(agent.model || "").trim().slice(0, 120),
      summary: String(agent.summary || "").trim().slice(0, 8e3)
    };
  }).filter(Boolean) : [];
  const strategySuggestions = Array.isArray(source.strategySuggestions) ? source.strategySuggestions.slice(-50).map((suggestion, index) => {
    if (!isObject(suggestion)) return null;
    const id = String(suggestion.id || `strategy-${index + 1}`).trim().slice(0, 120);
    const text = String(suggestion.text || "").trim().slice(0, 4e3);
    if (!id || !text) return null;
    return {
      id,
      text,
      status: ["queued", "applied"].includes(suggestion.status) ? suggestion.status : "queued",
      submittedAt: String(suggestion.submittedAt || ""),
      appliedAt: suggestion.appliedAt ? String(suggestion.appliedAt) : null,
      waveIndex: Number.isInteger(suggestion.waveIndex) ? suggestion.waveIndex : null
    };
  }).filter(Boolean) : [];
  const events = Array.isArray(source.events) ? source.events.slice(-200).map((event, index) => {
    if (!isObject(event)) return null;
    const message = String(event.message || "").trim().slice(0, 2e3);
    if (!message) return null;
    return {
      id: String(event.id || `event-${index + 1}`).trim().slice(0, 120),
      type: String(event.type || "info").trim().slice(0, 80),
      message,
      at: String(event.at || "")
    };
  }).filter(Boolean) : [];
  return {
    ...normalizeExecutionFields(source),
    status: [
      "idle",
      "starting",
      "running",
      "completed",
      "failed",
      "cancelled"
    ].includes(source.status) ? source.status : "idle",
    runId: typeof source.runId === "string" ? source.runId.trim().slice(0, 200) || null : null,
    currentWaveIndex: Math.max(
      0,
      Number.parseInt(source.currentWaveIndex, 10) || 0
    ),
    workItems,
    agents,
    strategySuggestions,
    events,
    startedAt: source.startedAt ? String(source.startedAt) : null,
    completedAt: source.completedAt ? String(source.completedAt) : null,
    finalizedArtifactId: typeof source.finalizedArtifactId === "string" ? source.finalizedArtifactId.trim().slice(0, 120) || null : null,
    error: String(source.error || "").trim().slice(0, 2e3)
  };
}
function normalizeQuestion(value) {
  if (value === null) return null;
  if (!isObject(value)) return null;
  const id = String(value.id || "").trim().slice(0, 120);
  const text = String(value.text || "").trim().slice(0, 2e3);
  if (!id || !text) return null;
  const choices = normalizeStringList(value.choices).slice(0, 6);
  const recommended = choices.includes(value.recommended) ? value.recommended : null;
  return {
    id,
    text,
    rationale: String(value.rationale || "").trim().slice(0, 1200),
    choices,
    recommended,
    allowFreeText: value.allowFreeText !== false,
    answerPlaceholder: String(value.answerPlaceholder || "").trim().slice(0, 200)
  };
}
function normalizePrototypeReview(value) {
  const revisions = isObject(value) && Array.isArray(value.revisions) ? value.revisions.slice(-50).map((revision, index) => {
    if (!isObject(revision)) return null;
    const id = String(revision.id || `revision-${index + 1}`).trim().slice(0, 120);
    const suggestion = String(revision.suggestion || "").trim().slice(0, 4e3);
    if (!id || !suggestion) return null;
    const status = [
      "processing",
      "clarifying",
      "applied",
      "failed"
    ].includes(revision.status) ? revision.status : "processing";
    const clarifications = Array.isArray(revision.clarifications) ? revision.clarifications.slice(0, 20).map((clarification) => {
      if (!isObject(clarification)) return null;
      const question = String(
        clarification.question || ""
      ).trim().slice(0, 2e3);
      const answer = String(
        clarification.answer || ""
      ).trim().slice(0, 4e3);
      return question && answer ? { question, answer } : null;
    }).filter(Boolean) : [];
    return {
      id,
      suggestion,
      status,
      summary: String(revision.summary || "").trim().slice(0, 4e3),
      clarifications,
      submittedAt: String(revision.submittedAt || ""),
      completedAt: revision.completedAt ? String(revision.completedAt) : null
    };
  }).filter(Boolean) : [];
  const revisionIds = new Set(revisions.map((revision) => revision.id));
  const activeRevisionId = isObject(value) && revisionIds.has(value.activeRevisionId) ? value.activeRevisionId : null;
  const evidence = isObject(value) && Array.isArray(value.evidence) ? value.evidence.slice(-100).map((entry, index) => {
    if (!isObject(entry)) return null;
    const id = String(entry.id || `evidence-${index + 1}`).trim().slice(0, 120);
    const content = String(entry.content || "").trim().slice(0, 8e3);
    if (!id || !content) return null;
    return {
      id,
      type: String(entry.type || "observation").trim().slice(0, 80),
      content,
      recordedAt: String(entry.recordedAt || "")
    };
  }).filter(Boolean) : [];
  return {
    revisions,
    activeRevisionId,
    question: isObject(value) ? normalizeQuestion(value.question) : null,
    evidence,
    designSpecArtifactId: isObject(value) && typeof value.designSpecArtifactId === "string" ? value.designSpecArtifactId.trim().slice(0, 120) || null : null
  };
}
function normalizeDecisionGraph(value, legacyQuestion = null) {
  const rawNodes = isObject(value) && Array.isArray(value.nodes) ? value.nodes : [];
  const nodes = [];
  const ids = /* @__PURE__ */ new Set();
  for (const rawNode of rawNodes.slice(0, 50)) {
    if (!isObject(rawNode)) continue;
    const id = normalizeDecisionId(rawNode.id);
    if (!id || ids.has(id)) throw new Error("Decision IDs must be nonempty and unique after normalization.");
    const normalizedQuestion = normalizeQuestion(rawNode.question);
    const question = normalizedQuestion ? { ...normalizedQuestion, id } : null;
    const title = String(rawNode.title || question?.text || id).trim().slice(0, 240);
    if (!title) continue;
    ids.add(id);
    nodes.push({
      id,
      title,
      dependencies: normalizeStringList(rawNode.dependencies).slice(0, 20).map(normalizeDecisionId),
      question,
      answer: typeof rawNode.answer === "string" && rawNode.answer.trim() ? rawNode.answer.trim().slice(0, 4e3) : null,
      status: "toAnswer"
    });
  }
  if (nodes.length === 0) {
    const question = normalizeQuestion(legacyQuestion);
    if (question) {
      nodes.push({
        id: question.id,
        title: question.text,
        dependencies: [],
        question,
        answer: null,
        status: "active"
      });
    }
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    node.dependencies = [
      ...new Set(
        node.dependencies.filter(
          (dependencyId) => Boolean(dependencyId)
        )
      )
    ];
  }
  validateDecisionGraph({ nodes });
  let activeAssigned = false;
  for (const node of nodes) {
    const dependenciesAnswered = node.dependencies.every(
      (dependencyId) => nodesById.get(dependencyId)?.answer
    );
    if (node.answer) {
      node.status = "answered";
    } else if (!activeAssigned && dependenciesAnswered && node.question) {
      node.status = "active";
      activeAssigned = true;
    } else {
      node.status = "toAnswer";
    }
  }
  return { nodes };
}
function revisionQuestionError(question) {
  if (!question) return null;
  const choices = question.choices || [];
  if (choices.length < 3 || choices.length > 5) {
    return "Prototype clarification questions must provide 3 to 5 options.";
  }
  if (new Set(choices.map((choice) => choice.toLowerCase())).size !== choices.length) {
    return "Prototype clarification options must be distinct.";
  }
  return null;
}
function firstActiveQuestion(decisionGraph) {
  return decisionGraph.nodes.find((node) => node.status === "active")?.question || null;
}
function generatedDecisionGraphError(decisionGraph, requirePrototypeApproach = false) {
  if (decisionGraph.nodes.length === 0) {
    return "The generated requirements DAG did not contain any decisions.";
  }
  if (decisionGraph.nodes.some((node) => !node.question)) {
    return "Every generated requirements node must include a complete question.";
  }
  const indegrees = new Map(
    decisionGraph.nodes.map((node) => [node.id, node.dependencies.length])
  );
  const dependents = new Map(
    decisionGraph.nodes.map((node) => [node.id, []])
  );
  for (const node of decisionGraph.nodes) {
    for (const dependencyId of node.dependencies) {
      dependents.get(dependencyId)?.push(node.id);
    }
  }
  const ready = [...indegrees].filter(([, indegree]) => indegree === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop();
    visited += 1;
    for (const dependentId of dependents.get(id) || []) {
      const nextIndegree = indegrees.get(dependentId) - 1;
      indegrees.set(dependentId, nextIndegree);
      if (nextIndegree === 0) ready.push(dependentId);
    }
  }
  if (visited !== decisionGraph.nodes.length) {
    return "The generated requirements graph contains a dependency cycle.";
  }
  if (!decisionGraph.nodes.some((node) => node.status === "active")) {
    return "The generated requirements DAG did not expose an active decision.";
  }
  if (requirePrototypeApproach && !decisionGraph.nodes.some((node) => node.id === "prototype-approach")) {
    return "The requirements DAG must include the prototype-approach decision.";
  }
  return null;
}
function dependentNodeIds(decisionGraph, changedNodeId) {
  const invalidated = /* @__PURE__ */ new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of decisionGraph.nodes) {
      if (node.id !== changedNodeId && !invalidated.has(node.id) && node.dependencies.some(
        (dependencyId) => dependencyId === changedNodeId || invalidated.has(dependencyId)
      )) {
        invalidated.add(node.id);
        changed = true;
      }
    }
  }
  return invalidated;
}
function invalidateDependentNodes(decisionGraph, changedNodeId) {
  const nodes = decisionGraph.nodes.map((node) => ({
    ...node,
    dependencies: [...node.dependencies],
    question: node.question ? { ...node.question } : null
  }));
  const invalidated = dependentNodeIds(decisionGraph, changedNodeId);
  for (const node of nodes) {
    if (invalidated.has(node.id)) {
      node.answer = null;
      node.status = "toAnswer";
    }
  }
  return normalizeDecisionGraph({ nodes });
}
function normalizeLifecycle(value) {
  const completedInput = new Set(
    isObject(value) ? normalizeStringList(value.completedStages) : []
  );
  if (isObject(value) && value.currentStage && value.currentStage !== "prepare" && !completedInput.has("prepare")) {
    completedInput.add("prepare");
  }
  const completedStages = [];
  for (const stage of LIFECYCLE_STAGES) {
    if (!completedInput.has(stage.id)) break;
    completedStages.push(stage.id);
  }
  const outputs = isObject(value) && Array.isArray(value.outputs) ? value.outputs.filter(
    (output) => isObject(output) && LIFECYCLE_STAGES.some((stage) => stage.id === output.stageId)
  ).map((output) => {
    const path = String(output.path || "").slice(0, 500);
    const legacyPrefix = [".intent", "studio"].join("");
    return {
      stageId: LIFECYCLE_STAGES.find((stage) => stage.id === output.stageId).id,
      path: path.startsWith(legacyPrefix) ? `.tandem${path.slice(legacyPrefix.length)}` : path,
      completedAt: String(output.completedAt || "")
    };
  }) : [];
  const skippedStages = isObject(value) && Array.isArray(value.skippedStages) ? value.skippedStages.filter(
    (entry) => isObject(entry) && completedStages.includes(entry.stageId) && LIFECYCLE_STAGES.some(
      (stage) => stage.id === entry.stageId
    )
  ).map((entry) => ({
    stageId: LIFECYCLE_STAGES.find((stage) => stage.id === entry.stageId).id,
    reason: String(entry.reason || "").trim().slice(0, 500),
    skippedAt: String(entry.skippedAt || "")
  })).filter(
    (entry, index, entries) => entries.findIndex(
      (candidate) => candidate.stageId === entry.stageId
    ) === index
  ) : [];
  const currentStage = LIFECYCLE_STAGES[Math.min(completedStages.length, LIFECYCLE_STAGES.length - 1)].id;
  const history = isObject(value) && Array.isArray(value.history) ? value.history.filter((output) => isObject(output) && LIFECYCLE_STAGES.some((stage) => stage.id === output.stageId) && typeof output.path === "string" && typeof output.completedAt === "string") : [];
  return { currentStage, completedStages, outputs, skippedStages, history };
}
function normalizeReloadReceipt(value) {
  if (!isObject(value)) return null;
  if (!["reloading", "success", "error"].includes(value.status)) return null;
  return {
    status: value.status,
    message: String(value.message || "").trim().slice(0, 500),
    requestedAt: String(value.requestedAt || ""),
    completedAt: value.completedAt ? String(value.completedAt) : null,
    extensionId: USER_EXTENSION_ID
  };
}
function normalizeProcessing(value) {
  if (!isObject(value)) return null;
  if (!["running", "success", "error"].includes(value.status)) return null;
  const requestId = String(value.requestId || "").trim().slice(0, 120);
  if (!requestId) return null;
  return {
    status: value.status,
    action: ANSWER_ACTIONS.has(value.action) ? value.action : "answer-decision",
    message: String(value.message || "").trim().slice(0, 500),
    requestId,
    factoryName: value.factoryName ? String(value.factoryName).trim().slice(0, 200) : null,
    answer: typeof value.answer === "string" ? value.answer.trim().slice(0, 4e3) : null,
    runId: value.runId ? String(value.runId).trim().slice(0, 200) : null,
    requestedAt: String(value.requestedAt || ""),
    completedAt: value.completedAt ? String(value.completedAt) : null,
    question: normalizeQuestion(value.question),
    originalDecisionGraph: value.action === "change-answer" ? normalizeDecisionGraph(value.originalDecisionGraph) : null
  };
}
function normalizeSuggestionProcessing(value) {
  if (!isObject(value)) return null;
  if (!["running", "success", "error"].includes(value.status)) return null;
  const requestId = String(value.requestId || "").trim().slice(0, 120);
  if (!requestId) return null;
  return {
    status: value.status,
    message: String(value.message || "").trim().slice(0, 500),
    requestId,
    factoryName: String(
      value.factoryName || SUGGESTION_FACTORY_NAME
    ).trim().slice(0, 200),
    runId: value.runId ? String(value.runId).trim().slice(0, 200) : null,
    usageItems: normalizeStringList(value.usageItems).map((item) => item.slice(0, 500)).slice(0, 30),
    requestedAt: String(value.requestedAt || ""),
    completedAt: value.completedAt ? String(value.completedAt) : null
  };
}
function normalizeStoredState(value, prototypeId) {
  if (!isObject(value) || value.version !== 1 || !isObject(value.lifecycle) || !isObject(value.requirements) || !Array.isArray(value.artifacts) || typeof value.goal !== "string") {
    throw new ProjectStoreError("state_schema_invalid", `Saved state for "${prototypeId}" is incomplete or unsupported. Restore the original file before continuing.`, 422);
  }
  const phase = ["discovery", "building", "iterating", "complete"].includes(value.phase) ? value.phase : "discovery";
  const previewStatus = ["waiting", "starting", "ready", "error"].includes(value.previewStatus) ? value.previewStatus : "waiting";
  const lifecycle = normalizeLifecycle(value.lifecycle);
  const isUsageSubstage = isObject(value.requirements) && value.requirements.substage === "usage";
  const decisionGraph = normalizeDecisionGraph(
    value.decisionGraph,
    isUsageSubstage ? null : value.question
  );
  const requirements = normalizeRequirements(value.requirements, decisionGraph);
  const planning = normalizePlanning(value.planning);
  const designReview = normalizeDesignReview(value.designReview);
  const testDesignReview = normalizeDesignReview(value.testDesignReview);
  return {
    ...createState(prototypeId),
    revision: value.revision ?? 0,
    generation: typeof value.generation === "string" && value.generation ? value.generation : `legacy-${prototypeId}`,
    openResetRequestId: typeof value.openResetRequestId === "string" ? value.openResetRequestId : null,
    jobOwner: isObject(value.jobOwner) && typeof value.jobOwner.sessionId === "string" && typeof value.jobOwner.workspaceRoot === "string" ? {
      sessionId: value.jobOwner.sessionId,
      workspaceRoot: value.jobOwner.workspaceRoot
    } : null,
    stage: lifecycle.currentStage,
    lifecycle,
    goal: String(value.goal || "").slice(0, 4e3),
    phase,
    status: String(value.status || "").slice(0, 1e3),
    preparation: normalizePreparation(value.preparation),
    prototypeApproach: normalizePrototypeApproach(value.prototypeApproach),
    requirements,
    question: requirements.substage === "usage" ? usageQuestion(requirements.suggestions) : firstActiveQuestion(decisionGraph),
    decisionGraph,
    confirmed: normalizeStringList(value.confirmed),
    assumed: normalizeStringList(value.assumed),
    deferred: normalizeStringList(value.deferred),
    artifacts: normalizeArtifacts(value.artifacts),
    previewUrl: normalizePreviewUrl(value.previewUrl, true),
    previewStatus,
    prototypeReview: normalizePrototypeReview(value.prototypeReview),
    design: normalizeDesign(value.design, designReview),
    designReview,
    testDesignReview,
    planning,
    implementation: normalizeImplementation(value.implementation, planning),
    testing: normalizeTesting(value.testing, testDesignReview),
    processing: normalizeProcessing(value.processing),
    suggestionProcessing: normalizeSuggestionProcessing(
      value.suggestionProcessing
    ),
    reloadReceipt: normalizeReloadReceipt(value.reloadReceipt),
    updatedAt: String(value.updatedAt || (/* @__PURE__ */ new Date()).toISOString())
  };
}
function normalizePreviewUrl(value, allowInvalidAsNull = false) {
  if (value === null || value === void 0 || value === "") return null;
  try {
    const parsed = new URL(String(value));
    const allowedHost = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
    if (!["http:", "https:"].includes(parsed.protocol) || !allowedHost) {
      throw new Error("Preview URL must use HTTP on a loopback host.");
    }
    return parsed.href;
  } catch (error) {
    if (allowInvalidAsNull) return null;
    throw new CanvasError(
      "invalid_preview_url",
      error instanceof Error ? error.message : "Invalid preview URL."
    );
  }
}
function readHtmlAttribute(tag, attribute) {
  const match = tag.match(
    new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match ? match[1] ?? match[2] ?? "" : null;
}
async function verifyPreviewIdentity(url, prototypeId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5e3);
  let html = "";
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error"
    });
    if (!response.ok) throw new CanvasError("preview_unreachable", `The prototype URL returned HTTP ${response.status}.`);
    if (response.body) {
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        while (bytes < 256 * 1024) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const remaining = 256 * 1024 - bytes;
          const value = chunk.value.slice(0, remaining);
          chunks.push(value);
          bytes += value.length;
        }
      } finally {
        await reader.cancel();
      }
      html = Buffer.concat(chunks).toString("utf8");
    }
  } catch (error) {
    if (error instanceof CanvasError) throw error;
    throw new CanvasError(
      "preview_unreachable",
      `The prototype URL is not reachable: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
  const markerTag = (html.match(/<meta\b[^>]*>/gi) || []).find(
    (tag) => PREVIEW_IDENTITY_MARKERS.has(readHtmlAttribute(tag, "name"))
  );
  const markerValue = markerTag ? readHtmlAttribute(markerTag, "content") : null;
  const actualId = markerValue ? normalizePrototypeId(markerValue) : null;
  if (!actualId) {
    throw new CanvasError(
      "preview_identity_missing",
      `The page at ${url} does not declare <meta name="tandem-prototype-id" content="${prototypeId}">.`
    );
  }
  if (actualId !== prototypeId) {
    throw new CanvasError(
      "preview_identity_mismatch",
      `The page at ${url} belongs to prototype "${actualId}", not "${prototypeId}".`
    );
  }
}
async function loadState(prototypeId) {
  const id = normalizePrototypeId(prototypeId);
  const state = await projectStore.load(id);
  if (!stateCache.has(id) || stateCache.get(id).revision <= state.revision) stateCache.set(id, state);
  return state;
}
async function persistState(state) {
  state.jobOwner = hasActiveWork(state) ? state.jobOwner || { sessionId: session.sessionId, workspaceRoot: WORKSPACE_ROOT } : null;
  await projectStore.save(state);
  stateCache.set(state.prototypeId, state);
}
async function withAnswerClaim(prototypeId, operation, rejectIfBusy = false) {
  try {
    return await projectStore.transaction(prototypeId, async () => {
      const current = await loadState(prototypeId);
      if (hasActiveWork(current) && current.jobOwner && !sameOwner(current.jobOwner, { sessionId: session.sessionId, workspaceRoot: WORKSPACE_ROOT })) {
        throw new AnswerRequestError(409, "This project has active work owned by another session/workspace. Return to its owning session before changing it.");
      }
      return operation();
    }, rejectIfBusy);
  } catch (error) {
    if (error instanceof ProjectStoreError && error.statusCode === 409) {
      throw new AnswerRequestError(409, error.message);
    }
    throw error;
  }
}
async function isPreferredAnswerProvider(extensionId) {
  const extensionList = await session.rpc.extensions.list();
  const runningIds = new Set(
    extensionList.extensions.filter((extension) => extension.status === "running").map((extension) => extension.id)
  );
  if (runningIds.has(USER_EXTENSION_ID)) {
    return extensionId === USER_EXTENSION_ID;
  }
  return runningIds.has(PROJECT_EXTENSION_ID) && extensionId === PROJECT_EXTENSION_ID;
}
async function refreshEntryAnswerCapability(entry) {
  const wasEnabled = entry.canSubmitAnswers;
  let state = await loadState(entry.prototypeId);
  entry.canSubmitAnswers = await isPreferredAnswerProvider(entry.extensionId) && (!hasActiveWork(state) || !state.jobOwner || sameOwner(state.jobOwner, { sessionId: session.sessionId, workspaceRoot: WORKSPACE_ROOT }));
  if (entry.canSubmitAnswers) {
    if (!wasEnabled) {
      recoverPreparationFactory(state, true);
      recoverAnswerFactory(state, true);
      recoverSuggestionFactory(state, true);
      state = state.lifecycle.currentStage === "prepare" ? await ensurePreparationStarted(state, true) : await ensureUsageSuggestionsStarted(state, true);
    }
    recoverPrototypeCompletion(state, true);
  }
}
function publicState(entry, state) {
  const source = String(entry.extensionId || "").split(":", 1)[0] || "unknown";
  return {
    ...state,
    provider: {
      extensionId: entry.extensionId,
      source,
      canReload: entry.extensionId === USER_EXTENSION_ID,
      canSubmitAnswers: entry.canSubmitAnswers && (!hasActiveWork(state) || !state.jobOwner || sameOwner(state.jobOwner, { sessionId: session.sessionId, workspaceRoot: WORKSPACE_ROOT }))
    }
  };
}
function publishState(prototypeId) {
  const state = stateCache.get(prototypeId);
  if (!state) return;
  for (const entry of servers.values()) {
    if (entry.prototypeId !== prototypeId) continue;
    const event = `data: ${JSON.stringify(publicState(entry, state))}

`;
    for (const client of entry.clients) {
      client.write(event);
    }
  }
}
function preparationMessage(text, kind = "info") {
  return {
    id: randomUUID3(),
    text,
    kind,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function preparationToken(state) {
  const processing = state.preparation.processing;
  if (!processing?.requestId || processing.generation !== state.generation) {
    throw new CanvasError("legacy_preparation", "This preparation job predates durable request identity. Inspect its prior run and retry explicitly.");
  }
  return { requestId: processing.requestId, generation: processing.generation, runId: processing.runId };
}
function preparationMatches(state, token, binding = false) {
  const processing = state.preparation.processing;
  return state.lifecycle.currentStage === "prepare" && ["starting", "running"].includes(state.preparation.status) && state.generation === token.generation && processing?.requestId === token.requestId && processing.generation === token.generation && (processing.runId === token.runId || binding && !processing.runId);
}
async function bindPreparationRun(prototypeId, token) {
  if (!token.runId || !await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) return false;
  return withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (!preparationMatches(current, token, true)) return false;
    if (current.preparation.processing.runId === token.runId) return true;
    const next = {
      ...current,
      preparation: normalizePreparation({
        ...current.preparation,
        status: "running",
        processing: { ...current.preparation.processing, runId: token.runId }
      }),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
}
async function recordPreparationWorkItem(prototypeId, workItemId, status, token, result = "") {
  await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (!preparationMatches(current, token)) throw new CanvasError("preparation_superseded", "This preparation job no longer owns the effort.");
    if (!current.preparation.workItems.some((item2) => item2.id === workItemId) || !["running", "completed", "failed"].includes(status) || status === "completed" && !String(result).trim()) {
      throw new Error("Preparation returned an invalid work-item result.");
    }
    const workItems = current.preparation.workItems.map(
      (item2) => item2.id === workItemId ? {
        ...item2,
        status,
        result: String(result || "").trim().slice(0, 4e3)
      } : item2
    );
    const item = workItems.find((candidate) => candidate.id === workItemId);
    const message = status === "running" ? `${item?.title || "Preparation work"} started.` : status === "completed" ? `${item?.title || "Preparation work"} completed.` : `${item?.title || "Preparation work"} failed.`;
    const next = {
      ...current,
      preparation: normalizePreparation({
        ...current.preparation,
        status: status === "failed" ? "failed" : "running",
        workItems,
        messages: [
          ...current.preparation.messages,
          preparationMessage(
            message,
            status === "failed" ? "error" : status === "completed" ? "success" : "info"
          )
        ]
      }),
      status: message,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
function preparationWorkspacePrompt(args) {
  return [
    "Inspect the target workspace for Tandem preparation.",
    "Do not edit files, install dependencies, start servers, or create branches.",
    "Inspect only repository structure, guidance files, manifests, package managers,",
    "run commands, version-control state, and availability of runtimes or container",
    "tools that materially affect the goal. Report concrete readiness checks.",
    "Return at most ten readiness checks.",
    "",
    `Project root: ${args.projectRoot}`,
    `Goal: ${args.goal}`
  ].join("\n");
}
function preparationSourcesPrompt(args, workspaceAnalysis) {
  return [
    "Analyze the named products, repositories, methods, benchmarks, and domain",
    "terms in this Tandem goal. Use authoritative repositories, official docs, or",
    "primary papers only. Use at most four source calls total. Do not edit files,",
    "install dependencies, or start servers. Identify the implementation target,",
    "important inputs and outputs, integration boundaries, and execution workflow.",
    "Return source URLs and any additional readiness checks.",
    "Return at most ten additional checks and twenty source references.",
    "",
    `Project root: ${args.projectRoot}`,
    `Goal: ${args.goal}`,
    "Workspace analysis:",
    JSON.stringify(workspaceAnalysis, null, 2)
  ].join("\n");
}
function preparationHandoffPrompt(args, workspaceAnalysis, sourceAnalysis) {
  return [
    "Synthesize the completed Tandem preparation analysis. Do not use tools or",
    "perform more research. Produce a concise requirements handoff.",
    "Suggested usages must be distinct first-person sentences beginning with",
    "'I want to'. Infer assumptions and explicitly defer missing runtime,",
    "credential, platform, or expensive execution work.",
    "Choose prototypeApproach build for a new GUI, validate-existing when an",
    "existing GUI materially helps evaluate the flow, not-applicable only when",
    "no graphical validation adds value, and undecided when the evidence does",
    "not justify choosing yet.",
    "",
    `Goal: ${args.goal}`,
    "Workspace analysis:",
    JSON.stringify(workspaceAnalysis, null, 2),
    "Authoritative source analysis:",
    JSON.stringify(sourceAnalysis, null, 2)
  ].join("\n");
}
async function settlePreparationRun(prototypeId, run, token) {
  await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (!preparationMatches(current, token) || (run.runId || null) !== token.runId) {
      await logSafely("Ignored a superseded preparation result.", "warning");
      return;
    }
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (run.status !== "completed" || !isObject(run.result)) {
      const error = factoryErrorMessage(run).slice(0, 4e3);
      const next2 = {
        ...current,
        preparation: normalizePreparation({
          ...current.preparation,
          status: "failed",
          workItems: current.preparation.workItems.map(
            (item) => item.status === "running" ? { ...item, status: "failed", result: error } : item
          ),
          messages: [
            ...current.preparation.messages,
            preparationMessage(
              `Preparation failed: ${error}`,
              "error"
            )
          ],
          processing: current.preparation.processing ? {
            ...current.preparation.processing,
            completedAt
          } : null,
          error
        }),
        status: `Preparation failed: ${error}`,
        updatedAt: completedAt
      };
      await persistState(next2);
      publishState(prototypeId);
      return;
    }
    const result = run.result;
    if (!["ready", "needs-attention"].includes(result.status) || typeof result.summary !== "string" || !result.summary.trim() || result.summary.length > 2e3 || !Array.isArray(result.checks) || !Array.isArray(result.sources) || result.checks.length > 20 || result.sources.length > 20 || result.checks.some((check) => !isObject(check) || typeof check.label !== "string" || !check.label.trim() || !["ready", "missing", "deferred"].includes(check.status) || typeof check.detail !== "string") || result.sources.some((source) => !isObject(source) || typeof source.title !== "string" || !source.title.trim() || !normalizeSourceUrl(source.url) || typeof source.purpose !== "string") || !Array.isArray(result.suggestedUsages) || result.suggestedUsages.length === 0 || result.suggestedUsages.length > 5 || result.suggestedUsages.some((usage) => typeof usage !== "string" || !usage.trim() || usage.length > 500) || !Array.isArray(result.assumed) || !Array.isArray(result.deferred) || result.assumed.length > 20 || result.deferred.length > 20 || [...result.assumed, ...result.deferred].some((item) => typeof item !== "string" || !item.trim() || item.length > 500) || !isObject(result.prototypeApproach) || !["undecided", "build", "validate-existing", "not-applicable"].includes(result.prototypeApproach.mode) || typeof result.prototypeApproach.reason !== "string" || current.preparation.workItems.length !== 3 || current.preparation.workItems.some((item) => item.status !== "completed")) {
      throw new Error("Preparation did not produce a complete, evidenced Requirements handoff.");
    }
    const preparation = normalizePreparation({
      ...current.preparation,
      status: result.status,
      summary: result.summary,
      workItems: current.preparation.workItems.map((item) => ({
        ...item,
        status: "completed"
      })),
      messages: [
        ...current.preparation.messages,
        preparationMessage(
          result.status === "ready" ? "Preparation completed. Requirements are ready." : "Preparation completed with items requiring attention.",
          result.status === "ready" ? "success" : "warning"
        )
      ],
      checks: result.checks,
      sources: result.sources,
      suggestedUsages: result.suggestedUsages,
      processing: current.preparation.processing ? { ...current.preparation.processing, completedAt } : null,
      error: ""
    });
    const requirements = normalizeRequirements(
      {
        ...current.requirements,
        substage: "usage",
        suggestions: result.suggestedUsages
      },
      { nodes: [] }
    );
    const outputPath = projectStore.stagePath(prototypeId, "prepare", current.revision + 1);
    const relativeOutputPath = relative(SHARED_PROJECT_ROOT, outputPath);
    await mkdir2(dirname2(outputPath), { recursive: true });
    await writeJsonAtomically(outputPath, {
      version: 1,
      prototypeId,
      stageId: "prepare",
      revision: current.revision + 1,
      completedAt,
      result: {
        goal: current.goal,
        preparation,
        prototypeApproach: result.prototypeApproach,
        requirements,
        assumed: result.assumed,
        deferred: result.deferred
      }
    });
    const lifecycle = normalizeLifecycle({
      ...current.lifecycle,
      currentStage: "requirements",
      completedStages: ["prepare"],
      outputs: [
        ...current.lifecycle.outputs.filter(
          (output) => output.stageId !== "prepare"
        ),
        {
          stageId: "prepare",
          path: relativeOutputPath,
          completedAt
        }
      ]
    });
    const next = {
      ...current,
      stage: "requirements",
      lifecycle,
      phase: "discovery",
      status: "Preparation complete. Review the analysis suggestions and add the usages you want.",
      preparation,
      prototypeApproach: normalizePrototypeApproach(
        result.prototypeApproach
      ),
      requirements,
      question: usageQuestion(requirements.suggestions),
      assumed: normalizeStringList(result.assumed),
      deferred: normalizeStringList(result.deferred),
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function runPreparationFactory(prototypeId, state, resumeFromRunId = null) {
  const token = preparationToken(state);
  const run = resumeFromRunId ? await resumeHaltedRun(resumeFromRunId) : await session.rpc.factory.run({
    name: PREPARATION_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      goal: state.goal,
      requestId: token.requestId,
      generation: token.generation
    },
    options: {
      limits: {
        maxConcurrentSubagents: 1,
        maxTotalSubagents: 3,
        timeoutSeconds: 240,
        maxAiCredits: 1024e3
      }
    }
  });
  token.runId = run.runId;
  if (!await bindPreparationRun(prototypeId, token)) {
    if (!isFactoryRunTerminal(run.status) && !resumeFromRunId) await session.factory.cancel(run.runId);
    return;
  }
  const terminal = isFactoryRunTerminal(run.status) ? run : await session.factory.waitForRun(run.runId);
  await settlePreparationRun(prototypeId, terminal, token);
}
function startPreparationFactory(prototypeId, state, resumeFromRunId = null) {
  if (activePreparationRuns.has(prototypeId)) return;
  const work = runPreparationFactory(prototypeId, state, resumeFromRunId).catch(async (error) => {
    const latest = await loadState(prototypeId);
    const token = preparationToken(state);
    if (latest.generation !== token.generation || latest.preparation.processing?.requestId !== token.requestId) {
      await logSafely("Preparation failed after its request was replaced.", "warning");
      return;
    }
    token.runId = latest.preparation.processing.runId;
    await settlePreparationRun(prototypeId, {
      runId: token.runId,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    }, token);
  }).finally(() => {
    if (activePreparationRuns.get(prototypeId) === work) {
      activePreparationRuns.delete(prototypeId);
    }
  });
  activePreparationRuns.set(prototypeId, work);
}
async function ensurePreparationStarted(state, canSubmitAnswers) {
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "prepare" || state.preparation.status !== "not-started" || activePreparationRuns.has(state.prototypeId)) {
    return state;
  }
  const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
  const next = await withAnswerClaim(state.prototypeId, async () => {
    const current = await loadState(state.prototypeId);
    if (current.lifecycle.currentStage !== "prepare" || current.preparation.status !== "not-started") {
      return current;
    }
    const updated = {
      ...current,
      preparation: normalizePreparation({
        status: "starting",
        summary: "",
        workItems: preparationWorkItems(),
        messages: [
          preparationMessage(
            "Preparation requested. Inspecting the workspace first."
          )
        ],
        checks: [],
        sources: [],
        suggestedUsages: [],
        processing: {
          requestId: randomUUID3(),
          generation: current.generation,
          runId: null,
          requestedAt,
          completedAt: null
        },
        error: ""
      }),
      status: "Starting preparation...",
      updatedAt: requestedAt
    };
    await persistState(updated);
    publishState(state.prototypeId);
    return updated;
  });
  if (next.preparation.status === "starting") {
    startPreparationFactory(next.prototypeId, next);
  }
  return next;
}
function recoverPreparationFactory(state, canSubmitAnswers) {
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "prepare" || !["starting", "running"].includes(state.preparation.status) || activePreparationRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    const processing = state.preparation.processing;
    if (!processing?.requestId || processing.generation !== state.generation || !processing.runId) {
      await withAnswerClaim(state.prototypeId, async () => {
        const current = await loadState(state.prototypeId);
        if (current.generation !== state.generation || current.preparation.processing?.requestedAt !== processing?.requestedAt) return;
        const error = "The interrupted preparation run cannot be correlated safely. Inspect the previous run, then retry explicitly.";
        await persistState({
          ...current,
          preparation: normalizePreparation({
            ...current.preparation,
            status: "failed",
            error,
            workItems: current.preparation.workItems.map((item) => item.status === "running" ? { ...item, status: "failed", result: error } : item)
          }),
          status: error,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        publishState(state.prototypeId);
      });
      return;
    }
    const token = preparationToken(state);
    const runId = token.runId;
    let run = await session.factory.getRun(runId);
    if (run.status === "halted") {
      await runPreparationFactory(state.prototypeId, state, runId);
      return;
    }
    if (!isFactoryRunTerminal(run.status)) {
      run = await session.factory.waitForRun(run.runId);
    }
    await settlePreparationRun(state.prototypeId, run, token);
  })().catch(async (error) => {
    if (!state.preparation.processing?.requestId) {
      await logSafely(`Preparation recovery failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const token = preparationToken(state);
    await settlePreparationRun(state.prototypeId, {
      runId: token.runId,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    }, token);
  }).finally(() => {
    if (activePreparationRuns.get(state.prototypeId) === work) {
      activePreparationRuns.delete(state.prototypeId);
    }
  });
  activePreparationRuns.set(state.prototypeId, work);
}
async function resolvePrototypeId(instanceId, requestedId) {
  const explicitId = requestedId || instancePrototypeIds.get(instanceId);
  if (explicitId) return normalizePrototypeId(explicitId);
  return await loadCurrentPrototypeId() || DEFAULT_PROTOTYPE_ID;
}
async function applyCanvasReset(state, input, requestId, rehydrating, writable) {
  if (!input.reset || rehydrating || state.openResetRequestId === requestId) return state;
  if (!writable) throw new CanvasError("read_only_provider", "Reset the effort from its writable provider and owning session.");
  return withAnswerClaim(state.prototypeId, async () => {
    const current = await loadState(state.prototypeId);
    if (current.openResetRequestId === requestId) return current;
    if (hasActiveWork(current)) throw new CanvasError("processing_in_progress", "Finish or stop active work before resetting the effort.");
    const next = {
      ...createState(state.prototypeId),
      revision: current.revision,
      openResetRequestId: requestId,
      goal: typeof input.goal === "string" ? input.goal.trim().slice(0, 4e3) : ""
    };
    await persistState(next);
    publishState(state.prototypeId);
    return next;
  });
}
function isCanvasRehydration(ctx) {
  return ctx.reason === "rehydrate" || session.openCanvases.some((canvas) => canvas.instanceId === ctx.instanceId);
}
async function updateTandem(ctx) {
  const input = isObject(ctx.input) ? ctx.input : {};
  const prototypeId = await resolvePrototypeId(ctx.instanceId, input.prototypeId);
  if (!await isPreferredAnswerProvider(ctx.extensionId)) {
    throw new CanvasError(
      "read_only_provider",
      "Update Tandem through the installed user-scoped provider."
    );
  }
  return withAnswerClaim(prototypeId, async () => {
    const stored = await loadState(prototypeId);
    if (hasActiveWork(stored)) {
      throw new CanvasError(
        "processing_in_progress",
        "Wait for active Tandem work to finish before replacing project state."
      );
    }
    if (!input.reset && typeof input.goal === "string" && input.goal.trim() !== stored.goal && stored.lifecycle.currentStage !== "prepare") {
      throw new CanvasError("goal_locked", "Use a new effort or an explicit reset for a different goal.");
    }
    if (!input.reset && (["requirements", "decisionGraph", "confirmed", "assumed", "deferred"].some((key) => key in input) && stored.lifecycle.currentStage !== "requirements" || "planning" in input && stored.lifecycle.currentStage !== "plan" || "designReview" in input && stored.lifecycle.currentStage !== "design")) {
      throw new CanvasError("stage_locked", "Reopen the owning stage explicitly before changing its accepted inputs.");
    }
    const current = input.reset ? { ...createState(prototypeId), revision: stored.revision } : stored;
    const next = { ...current };
    if (typeof input.goal === "string") {
      next.goal = input.goal.trim().slice(0, 4e3);
    }
    if (typeof input.stage === "string" && input.stage !== next.lifecycle.currentStage) {
      throw new CanvasError("stage_locked", "Use stage completion or reopening to change lifecycle stages.");
    }
    if (["discovery", "building", "iterating", "complete"].includes(input.phase)) {
      next.phase = input.phase;
    }
    if (typeof input.status === "string") {
      next.status = input.status.trim().slice(0, 1e3);
    }
    if (Object.prototype.hasOwnProperty.call(input, "preparation")) {
      next.preparation = normalizePreparation(input.preparation);
    }
    if (Object.prototype.hasOwnProperty.call(input, "prototypeApproach")) {
      if (next.lifecycle.currentStage !== "requirements") {
        throw new CanvasError(
          "prototype_approach_locked",
          "Choose the prototype approach before completing Requirements."
        );
      }
      next.prototypeApproach = normalizePrototypeApproach(
        input.prototypeApproach
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "question")) {
      next.question = normalizeQuestion(input.question);
    }
    if (Object.prototype.hasOwnProperty.call(input, "requirements")) {
      next.requirements = normalizeRequirements(
        input.requirements,
        next.decisionGraph
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "decisionGraph")) {
      next.decisionGraph = normalizeDecisionGraph(
        input.decisionGraph,
        null
      );
      if (!input.reset && current.decisionGraph.nodes.some((node) => node.answer) && JSON.stringify(next.decisionGraph) !== JSON.stringify(current.decisionGraph)) {
        throw new CanvasError("authoritative_decisions", "Change confirmed answers through the decision controls; bulk updates cannot replace user decisions.");
      }
      const requirementsInput = Object.prototype.hasOwnProperty.call(
        input,
        "requirements"
      ) ? next.requirements : {
        ...next.requirements,
        substage: next.decisionGraph.nodes.length > 0 ? "dag" : next.requirements.substage
      };
      next.requirements = normalizeRequirements(
        requirementsInput,
        next.decisionGraph
      );
      next.question = next.requirements.substage === "usage" ? usageQuestion(next.requirements.suggestions) : firstActiveQuestion(next.decisionGraph);
    }
    if (Array.isArray(input.confirmed)) {
      next.confirmed = normalizeStringList(input.confirmed);
    }
    if (Array.isArray(input.assumed)) {
      next.assumed = normalizeStringList(input.assumed);
    }
    if (Array.isArray(input.deferred)) {
      next.deferred = normalizeStringList(input.deferred);
    }
    if (Array.isArray(input.artifacts)) {
      next.artifacts = normalizeArtifacts(
        input.artifacts,
        next.lifecycle.currentStage
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, "prototypeReview")) {
      next.prototypeReview = normalizePrototypeReview(input.prototypeReview);
    }
    if (Object.prototype.hasOwnProperty.call(input, "designReview")) {
      next.designReview = normalizeDesignReview(input.designReview);
    }
    if (Object.prototype.hasOwnProperty.call(input, "planning")) {
      next.planning = normalizePlanning(input.planning);
    }
    if (Object.prototype.hasOwnProperty.call(input, "previewUrl")) {
      const previewUrl = normalizePreviewUrl(input.previewUrl);
      if (previewUrl) {
        await verifyPreviewIdentity(previewUrl, prototypeId);
      }
      next.previewUrl = previewUrl;
    }
    if (["waiting", "starting", "ready", "error"].includes(input.previewStatus)) {
      next.previewStatus = input.previewStatus;
    }
    next.lifecycle = normalizeLifecycle(next.lifecycle);
    next.stage = next.lifecycle.currentStage;
    next.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await persistState(next);
    instancePrototypeIds.set(ctx.instanceId, prototypeId);
    await persistCurrentPrototypeId(prototypeId);
    publishState(prototypeId);
    return next;
  });
}
function stageCompletionError(state, stageId, { requirePrototypeSpec = true } = {}) {
  if (stageId === "prepare") {
    return "Preparation completes automatically when its worker finishes.";
  }
  if (stageId === "requirements") {
    if (state.prototypeApproach.mode === "undecided") {
      return "Resolve whether Prototype should build, validate, or be bypassed.";
    }
    if (state.requirements.substage !== "dag") {
      return "Generate the requirements DAG from at least one usage first.";
    }
    if (state.decisionGraph.nodes.length === 0) {
      return "Generate at least one requirement decision before finishing.";
    }
    const remaining = state.decisionGraph.nodes.filter((node) => !node.answer);
    if (remaining.length > 0) {
      return `${remaining.length} requirement decision${remaining.length === 1 ? "" : "s"} remain unanswered.`;
    }
    const requiredArtifactIds = [
      "requirements-result",
      ...state.prototypeApproach.mode === "not-applicable" ? ["draft-feature-spec"] : []
    ];
    const missingArtifactCount = requiredArtifactIds.filter(
      (id) => !state.artifacts.some((artifact) => artifact.id === id)
    ).length;
    if (state.artifacts.length + missingArtifactCount > 30) {
      return `Remove ${state.artifacts.length + missingArtifactCount - 30} artifact${state.artifacts.length + missingArtifactCount - 30 === 1 ? "" : "s"} before finishing so the lifecycle handoff can be captured.`;
    }
  }
  if (stageId === "prototype" && state.previewStatus !== "ready") {
    return "The runnable prototype must be ready before this stage can finish.";
  }
  if (stageId === "prototype" && state.prototypeReview.question) {
    return "Answer the open prototype clarification before finishing.";
  }
  if (stageId === "prototype" && requirePrototypeSpec && !["draft-feature-spec", "design-spec"].includes(
    state.prototypeReview.designSpecArtifactId
  )) {
    return "Finish Prototype in Tandem to generate its draft feature specification.";
  }
  if (stageId === "design" && (state.designReview.processing || state.designReview.finalizeRequested || state.designReview.threads.some(
    (thread) => ["queued", "processing", "answered", "failed"].includes(
      thread.status
    )
  ) || state.testDesignReview.processing || state.testDesignReview.finalizeRequested || state.testDesignReview.threads.some(
    (thread) => ["queued", "processing", "answered", "failed"].includes(
      thread.status
    )
  ))) {
    return "Resolve every product and test design thread before completing Design.";
  }
  if (stageId === "design" && (!["design-spec", "design-review"].includes(
    state.designReview.finalizedArtifactId
  ) || state.testDesignReview.finalizedArtifactId !== "test-spec" || !state.artifacts.some(
    (artifact) => artifact.stage === "design" && ["design-spec", "design-review"].includes(artifact.id) && artifact.reviewStatus !== "stale"
  ) || !state.artifacts.some(
    (artifact) => artifact.stage === "design" && artifact.id === "test-spec" && artifact.kind === "test-spec" && artifact.reviewStatus !== "stale"
  ))) {
    return "Finish both Product design and Test design to capture design-spec and test-spec.";
  }
  if (stageId === "plan" && (state.planning.processing || state.planning.status !== "complete" || state.planning.finalizedArtifactId !== "execution-plan" || !state.artifacts.some(
    (artifact) => artifact.stage === "plan" && artifact.id === "execution-plan" && artifact.kind === "execution-plan" && artifact.reviewStatus !== "stale"
  ))) {
    return "Generate and finalize the execution plan before finishing Plan.";
  }
  if (stageId === "implement" && (state.implementation.status !== "completed" || state.implementation.workItems.some(
    (item) => item.status !== "completed"
  ) || state.implementation.finalizedArtifactId !== "final-code" || !state.artifacts.some(
    (artifact) => artifact.stage === "implement" && artifact.id === "final-code" && artifact.kind === "final-code" && artifact.path && artifact.reviewStatus !== "stale"
  ))) {
    return "Run every planned work item successfully before finishing Implement.";
  }
  if (stageId === "test" && (state.testing.status !== "completed" || state.testing.scenarios.some(
    (scenario) => scenario.status !== "passed"
  ) || state.testing.finalizedArtifactId !== "test-results" || !state.artifacts.some(
    (artifact) => artifact.stage === "test" && artifact.id === "test-results" && artifact.kind === "test-results" && artifact.reviewStatus !== "stale"
  ))) {
    return "Run every integration and interaction test successfully before finishing Test.";
  }
  return null;
}
function requirementsResultArtifact(state) {
  const section = (heading, items) => [
    `## ${heading}`,
    "",
    ...items.length > 0 ? items.map((item) => `- ${item}`) : ["- None"],
    ""
  ];
  return {
    id: "requirements-result",
    title: "Requirements",
    kind: "requirements",
    stage: "requirements",
    path: "",
    language: "markdown",
    content: [
      "# Requirements",
      "",
      ...section("Usage", state.requirements.usageItems),
      ...section("Confirmed", state.confirmed),
      ...section("Assumed", state.assumed),
      ...section("Deferred", state.deferred)
    ].join("\n").trim(),
    mermaid: ""
  };
}
function skippedPrototypeSpecArtifact(state) {
  const section = (heading, items) => [
    `## ${heading}`,
    "",
    ...items.length > 0 ? items.map((item) => `- ${item}`) : ["- None"],
    ""
  ];
  const decisions = state.decisionGraph.nodes.filter((node) => node.answer).map((node) => `${node.title}: ${node.answer}`);
  return {
    id: "draft-feature-spec",
    title: "Draft feature specification",
    kind: "feature-spec",
    stage: "prototype",
    path: "",
    language: "markdown",
    content: [
      "# Draft feature specification",
      "",
      "## Goal",
      "",
      state.goal || "No goal provided.",
      "",
      "## Experience validation",
      "",
      "Runtime UI prototyping is not applicable.",
      state.prototypeApproach.reason,
      "Design should validate the command, API, library, automation, or other non-graphical contract that exposes the requested behavior.",
      "",
      ...section("Usage", state.requirements.usageItems),
      ...section("Confirmed behavior", state.confirmed),
      ...section("Requirement decisions", decisions),
      ...section("Assumptions", state.assumed),
      ...section("Deferred work", state.deferred),
      "## Design handoff",
      "",
      "Define the externally observable contract, inputs, outputs, state transitions, failure behavior, and validation evidence without inventing a graphical interface."
    ].join("\n").trim(),
    mermaid: ""
  };
}
async function completeLifecycleStage(prototypeId, requestedStageId, extensionId) {
  if (!await isPreferredAnswerProvider(extensionId)) {
    throw new CanvasError(
      "read_only_provider",
      "Complete stages through the installed user-scoped provider."
    );
  }
  const completed = await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    if (hasActiveWork(state)) {
      throw new CanvasError(
        "processing_in_progress",
        "Wait for the hidden Tandem agent to finish."
      );
    }
    const lifecycle = normalizeLifecycle(state.lifecycle);
    const stageId = requestedStageId || lifecycle.currentStage;
    if (stageId !== lifecycle.currentStage) {
      throw new CanvasError(
        "stage_not_active",
        `Only the active ${lifecycle.currentStage} stage can be completed.`
      );
    }
    if (stageId === "test") await assertCurrentTestEvidence(state);
    if (lifecycle.completedStages.includes(stageId)) {
      return state;
    }
    const blocker = stageCompletionError(state, stageId);
    if (blocker) {
      throw new CanvasError("stage_not_ready", blocker);
    }
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const skipPrototype = stageId === "requirements" && state.prototypeApproach.mode === "not-applicable";
    const artifacts = stageId === "requirements" ? normalizeArtifacts([
      requirementsResultArtifact(state),
      ...skipPrototype ? [skippedPrototypeSpecArtifact(state)] : [],
      ...state.artifacts.filter(
        (artifact) => artifact.id !== "requirements-result" && (!skipPrototype || artifact.id !== "draft-feature-spec")
      )
    ]) : state.artifacts;
    const prototypeReview = skipPrototype ? normalizePrototypeReview({
      ...state.prototypeReview,
      question: null,
      activeRevisionId: null,
      designSpecArtifactId: "draft-feature-spec",
      evidence: [
        ...state.prototypeReview.evidence.filter(
          (entry) => entry.id !== "prototype-not-applicable"
        ),
        {
          id: "prototype-not-applicable",
          type: "prototype-disposition",
          content: state.prototypeApproach.reason,
          recordedAt: completedAt
        }
      ]
    }) : state.prototypeReview;
    const completedStageIds = [
      stageId,
      ...skipPrototype ? ["prototype"] : []
    ];
    const outputEntries = [];
    for (const completedStageId of completedStageIds) {
      const outputPath = projectStore.stagePath(prototypeId, completedStageId, state.revision + 1);
      const relativeOutputPath = relative(SHARED_PROJECT_ROOT, outputPath);
      await mkdir2(dirname2(outputPath), { recursive: true });
      await writeJsonAtomically(outputPath, {
        version: 1,
        prototypeId,
        stageId: completedStageId,
        revision: state.revision + 1,
        completedAt,
        skipped: skipPrototype && completedStageId === "prototype",
        skipReason: skipPrototype && completedStageId === "prototype" ? state.prototypeApproach.reason : null,
        result: {
          goal: state.goal,
          preparation: state.preparation,
          prototypeApproach: state.prototypeApproach,
          requirements: state.requirements,
          confirmed: state.confirmed,
          assumed: state.assumed,
          deferred: state.deferred,
          decisionGraph: state.decisionGraph,
          artifacts,
          previewUrl: state.previewUrl,
          previewStatus: state.previewStatus,
          prototypeReview,
          designReview: state.designReview,
          design: state.design,
          testDesignReview: state.testDesignReview,
          planning: state.planning,
          implementation: state.implementation,
          testing: state.testing
        }
      });
      outputEntries.push({
        stageId: completedStageId,
        path: relativeOutputPath,
        completedAt
      });
    }
    const completedStages = [
      ...lifecycle.completedStages,
      ...completedStageIds
    ];
    const currentStage = LIFECYCLE_STAGES[Math.min(completedStages.length, LIFECYCLE_STAGES.length - 1)].id;
    let next = {
      ...state,
      artifacts,
      prototypeReview,
      stage: currentStage,
      lifecycle: {
        currentStage,
        completedStages,
        history: lifecycle.history,
        outputs: [
          ...lifecycle.outputs.filter(
            (output) => !completedStageIds.includes(output.stageId)
          ),
          ...outputEntries
        ],
        skippedStages: skipPrototype ? [
          ...lifecycle.skippedStages.filter(
            (entry) => entry.stageId !== "prototype"
          ),
          {
            stageId: "prototype",
            reason: state.prototypeApproach.reason,
            skippedAt: completedAt
          }
        ] : lifecycle.skippedStages
      },
      phase: completedStages.length === LIFECYCLE_STAGES.length ? "complete" : currentStage === "requirements" ? "discovery" : "building",
      status: completedStages.length === LIFECYCLE_STAGES.length ? "All lifecycle stages are complete." : skipPrototype ? `Requirements completed. Prototype is not applicable: ${state.prototypeApproach.reason} Design is now enabled.` : `${LIFECYCLE_STAGES.find((stage) => stage.id === stageId).label} completed. ${LIFECYCLE_STAGES.find((stage) => stage.id === currentStage).label} is now enabled.`,
      updatedAt: completedAt
    };
    next = seedDefaultProductDesignReview(next, completedAt);
    await persistState(next);
    publishState(prototypeId);
    return next;
  });
  if (completed.lifecycle.currentStage === "prototype" && completed.previewStatus !== "ready" && completed.processing?.status !== "running") {
    return beginPrototypeBuild(prototypeId, extensionId);
  }
  if (completed.lifecycle.currentStage === "design" && completed.designReview.threads.some((thread) => thread.status === "queued")) {
    startDesignReviewQueue(prototypeId);
  }
  return completed;
}
async function reopenLifecycleStage(prototypeId, stageId, extensionId) {
  if (!await isPreferredAnswerProvider(extensionId)) {
    throw new CanvasError("read_only_provider", "Reopen stages through the active Tandem provider.");
  }
  const index = LIFECYCLE_STAGES.findIndex((stage) => stage.id === stageId);
  if (index < 0) throw new CanvasError("invalid_stage", "Select a valid lifecycle stage.");
  const reopened = await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    if (hasActiveWork(state)) throw new CanvasError("processing_in_progress", "Finish or stop active work before reopening a stage.");
    if (state.lifecycle.skippedStages.some((stage) => stage.stageId === stageId)) {
      throw new CanvasError("stage_not_applicable", "Reopen Requirements and change the prototype approach before enabling a skipped stage.");
    }
    if (!state.lifecycle.completedStages.includes(stageId)) {
      throw new CanvasError("stage_not_complete", "Only a completed stage can be reopened.");
    }
    const fresh = createState(prototypeId);
    const affected = (id) => LIFECYCLE_STAGES.findIndex((stage) => stage.id === id) >= index;
    const next = {
      ...state,
      generation: randomUUID3(),
      stage: LIFECYCLE_STAGES[index].id,
      lifecycle: {
        currentStage: LIFECYCLE_STAGES[index].id,
        completedStages: state.lifecycle.completedStages.slice(0, index),
        outputs: state.lifecycle.outputs.filter((output) => !affected(output.stageId)),
        history: [...state.lifecycle.history, ...state.lifecycle.outputs.filter((output) => affected(output.stageId))],
        skippedStages: state.lifecycle.skippedStages.filter((stage) => !affected(stage.stageId))
      },
      preparation: stageId === "prepare" ? fresh.preparation : state.preparation,
      prototypeApproach: stageId === "prepare" ? fresh.prototypeApproach : state.prototypeApproach,
      requirements: stageId === "prepare" ? fresh.requirements : state.requirements,
      decisionGraph: stageId === "prepare" ? fresh.decisionGraph : state.decisionGraph,
      question: stageId === "prepare" ? fresh.question : state.question,
      confirmed: stageId === "prepare" ? [] : state.confirmed,
      artifacts: invalidateArtifacts(state.artifacts, LIFECYCLE_STAGES[index].id),
      previewUrl: affected("requirements") ? null : state.previewUrl,
      previewStatus: affected("requirements") ? "waiting" : state.previewStatus,
      prototypeReview: affected("prototype") ? {
        ...state.prototypeReview,
        designSpecArtifactId: null,
        question: null,
        activeRevisionId: null
      } : state.prototypeReview,
      design: affected("design") ? { substage: "product" } : state.design,
      designReview: affected("design") ? {
        ...state.designReview,
        processing: null,
        finalizedArtifactId: null,
        finalizeRequested: false
      } : state.designReview,
      testDesignReview: affected("design") ? {
        ...state.testDesignReview,
        processing: null,
        finalizedArtifactId: null,
        finalizeRequested: false
      } : state.testDesignReview,
      planning: affected("plan") ? {
        ...state.planning,
        processing: null,
        status: stageId === "plan" ? "ready" : "idle",
        finalizedArtifactId: null
      } : state.planning,
      implementation: affected("implement") ? fresh.implementation : state.implementation,
      testing: affected("test") ? fresh.testing : state.testing,
      processing: null,
      suggestionProcessing: null,
      phase: stageId === "prepare" ? fresh.phase : stageId === "requirements" ? "discovery" : "iterating",
      status: `${LIFECYCLE_STAGES[index].label} reopened. Dependent outputs are stale until reviewed and regenerated.`,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return next;
  });
  return stageId === "prepare" ? ensurePreparationStarted(reopened, true) : reopened;
}
async function beginPrototypeBuild(prototypeId, extensionId) {
  if (!await isPreferredAnswerProvider(extensionId)) {
    throw new CanvasError("read_only_provider", "Start the prototype through the active Tandem provider.");
  }
  const pending = await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    if (state.lifecycle.currentStage !== "prototype") throw new CanvasError("stage_not_active", "Prototype creation requires the Prototype stage.");
    if (!["build", "validate-existing"].includes(state.prototypeApproach.mode)) {
      throw new CanvasError("prototype_approach_required", "Choose an applicable prototype approach in Requirements before starting a preview.");
    }
    if (hasActiveWork(state)) throw new CanvasError("processing_in_progress", "A Tandem job is already active.");
    if (state.previewStatus === "ready") throw new CanvasError("preview_ready", "The prototype is already ready. Submit a revision instead.");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const question = {
      id: "build-prototype",
      text: "Build the initial runnable prototype from the accepted requirements.",
      rationale: "",
      choices: [],
      recommended: null,
      allowFreeText: false,
      answerPlaceholder: ""
    };
    const next = {
      ...state,
      phase: "building",
      previewStatus: "starting",
      status: "Scheduling the initial prototype build.",
      processing: {
        status: "running",
        action: "build-prototype",
        requestId: randomUUID3(),
        factoryName: ANSWER_FACTORY_NAME,
        runId: null,
        answer: "Build and launch the initial prototype using the accepted requirements.",
        question,
        requestedAt: now,
        completedAt: null,
        originalDecisionGraph: null,
        message: "The initial prototype build has been requested."
      },
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
    return next;
  }, true);
  startAnswerFactory(
    prototypeId,
    pending.processing.requestId,
    pending.processing.question,
    pending.processing.answer,
    "build-prototype",
    pending
  );
  return pending;
}
async function completeStage(ctx) {
  const input = isObject(ctx.input) ? ctx.input : {};
  const prototypeId = await resolvePrototypeId(ctx.instanceId, input.prototypeId);
  return completeLifecycleStage(
    prototypeId,
    typeof input.stageId === "string" ? input.stageId : "",
    ctx.extensionId
  );
}
function recoverPrototypeCompletion(state, canSubmitAnswers) {
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "prototype" || state.processing?.status !== "success" || state.processing.action !== "generate-design-spec" || !["draft-feature-spec", "design-spec"].includes(
    state.prototypeReview.designSpecArtifactId
  ) || activePrototypeCompletions.has(state.prototypeId)) {
    return;
  }
  activePrototypeCompletions.add(state.prototypeId);
  completeLifecycleStage(
    state.prototypeId,
    "prototype",
    PROVIDER_EXTENSION_ID
  ).catch(
    (error) => logSafely(
      `Tandem could not resume Prototype completion: ${error instanceof Error ? error.message : String(error)}`
    )
  ).finally(() => activePrototypeCompletions.delete(state.prototypeId));
}
async function readRequestBody(req) {
  return readJsonRequest(req, MAX_REQUEST_BYTES);
}
function sendJson(res, statusCode, value) {
  sendJsonResponse(res, statusCode, value);
}
function factoryStateSnapshot(state) {
  let remainingArtifactCharacters = 12e4;
  const artifacts = state.artifacts.map((artifact) => {
    const content = artifact.content.slice(
      0,
      Math.max(0, Math.min(2e4, remainingArtifactCharacters))
    );
    remainingArtifactCharacters -= content.length;
    const mermaid = artifact.mermaid.slice(
      0,
      Math.max(0, Math.min(12e3, remainingArtifactCharacters))
    );
    remainingArtifactCharacters -= mermaid.length;
    return {
      ...artifact,
      content,
      mermaid,
      contentTruncated: content.length < artifact.content.length,
      mermaidTruncated: mermaid.length < artifact.mermaid.length
    };
  });
  const reviewSnapshot = (review) => {
    let budget = 2e4;
    return {
      ...review,
      threads: review.threads.map((thread) => {
        const answer = thread.answer.slice(0, Math.max(0, Math.min(4e3, budget)));
        budget -= answer.length;
        return { ...thread, answer, answerTruncated: answer.length < thread.answer.length };
      })
    };
  };
  return {
    version: state.version,
    revision: state.revision,
    generation: state.generation,
    durableStatePath: projectStore.statePath(state.prototypeId),
    prototypeId: state.prototypeId,
    stage: state.stage,
    goal: state.goal,
    phase: state.phase,
    status: state.status,
    lifecycle: state.lifecycle,
    preparation: state.preparation,
    prototypeApproach: state.prototypeApproach,
    requirements: state.requirements,
    question: state.question,
    decisionGraph: state.decisionGraph,
    confirmed: state.confirmed,
    assumed: state.assumed,
    deferred: state.deferred,
    artifacts,
    previewUrl: state.previewUrl,
    previewStatus: state.previewStatus,
    prototypeReview: {
      ...state.prototypeReview,
      revisions: state.prototypeReview.revisions.slice(-4).map((revision) => ({
        ...revision,
        clarifications: revision.clarifications.slice(-3),
        omittedClarificationCount: Math.max(0, revision.clarifications.length - 3)
      })),
      evidence: state.prototypeReview.evidence.slice(-12).map((entry) => ({
        ...entry,
        content: entry.content.slice(0, 2e3),
        contentTruncated: entry.content.length > 2e3
      })),
      omittedRevisionCount: Math.max(0, state.prototypeReview.revisions.length - 4),
      omittedEvidenceCount: Math.max(0, state.prototypeReview.evidence.length - 12)
    },
    designReview: reviewSnapshot(state.designReview),
    design: state.design,
    testDesignReview: reviewSnapshot(state.testDesignReview),
    planning: state.planning,
    implementation: state.implementation,
    testing: state.testing
  };
}
function answerFactoryPrompt(args) {
  const actionInstructions = {
    "build-prototype": [
      args.state.prototypeApproach.mode === "validate-existing" ? "Run and revise the repository's existing GUI to validate the accepted requirements. Do not create a separate prototype app." : "Build the initial runnable prototype from the accepted requirements and answered DAG.",
      "Inspect the active repository and reuse its stack. Implement a working mock-driven UI, not only a plan.",
      "Start its development server through the available session-managed tools and capture its actual URL.",
      `Add <meta name="tandem-prototype-id" content="${args.prototypeId}"> to the served HTML.`,
      "Verify that URL responds with the identity marker and exercise the primary flow.",
      "Return previewUrl and previewStatus ready only after the running page is available.",
      "Do not alter accepted requirements or answers. Append concise prototype evidence and artifacts.",
      "If creation or startup fails, report the failure explicitly; do not claim a ready preview."
    ],
    "add-usage": [
      "The submitted answer is one new usage sentence. Append it exactly once to",
      "requirements.usageItems, keep requirements.substage as usage, and return an",
      "empty decision graph. Generate 3 to 5 concise, non-overlapping usage",
      "suggestions that complement everything already listed. Each suggestion must",
      "be one clickable first-person sentence describing how the user wants to",
      "use the deliverable. Start with 'I want to', not 'I can'."
    ],
    "generate-dag": [
      "Switch requirements.substage to dag and generate the complete requirements",
      "decision DAG from requirements.usageItems. Cover every listed usage while",
      "sharing common prerequisites. Give every node its complete question and",
      "choices now, including toAnswer nodes, so dependents can be regenerated.",
      "If prototypeApproach.mode is undecided, include an interface-validation",
      "decision with id prototype-approach whose choices map clearly to building",
      "a new GUI, validating an",
      "existing GUI, or bypassing Prototype. Keep the approach undecided until",
      "that node is answered.",
      "Return no usage suggestions."
    ],
    "answer-decision": [
      "Apply the submitted answer to the active DAG node. Recompute every transitive",
      "dependent node whose content is affected by the answer; do not carry forward",
      "static downstream wording that assumed a different answer. Promote the next",
      "eligible toAnswer node to active."
    ],
    "change-answer": [
      "The user changed an answered DAG node. Apply the new answer to that",
      "node and regenerate every transitive dependent node from the changed frontier.",
      "All descendant answers have already been cleared in the supplied state. Keep",
      "them unanswered and rewrite their titles, questions, choices, and dependencies",
      "to match the changed answer. Never preserve stale downstream decisions."
    ],
    "submit-revision": [
      "The answer is a prototype revision suggestion. First decide whether a",
      "material product or interaction detail is unclear. If clarification is",
      "required, do not edit files: set prototypeReview.question to one focused",
      "question with 3 to 5 options and mark the active revision clarifying.",
      "Otherwise implement the revision in the existing prototype, validate the",
      "running preview, mark the active revision applied, summarize the change,",
      "clear the question, and append concrete interaction evidence."
    ],
    "clarify-revision": [
      "The answer resolves prototypeReview.question for the active revision.",
      "Append the question and answer to that revision's clarifications. Apply the",
      "revision to the existing prototype and validate it. Ask one more focused",
      "question only if a material ambiguity remains; otherwise mark the revision",
      "applied, clear the question, summarize the result, and append evidence."
    ],
    "generate-design-spec": [
      "The user has finished prototype iteration. Do not edit prototype files and",
      "do not ask another question. Collect evidence from requirements, the answered",
      "DAG, prototypeReview revisions and clarifications, preview verification, and",
      "existing artifacts. Upsert one complete artifact with id draft-feature-spec,",
      "title Draft feature specification, kind feature-spec, stage prototype,",
      "language markdown, and no path or",
      "Mermaid source. Its content must cover goals, users, workflows, screens,",
      "interaction states, UI contracts, accepted revisions, accessibility,",
      "evidence, unresolved constraints, and a clear handoff for Design and Plan.",
      "Set prototypeReview.designSpecArtifactId to draft-feature-spec and clear its",
      "question."
    ]
  };
  return [
    "You are the hidden execution worker for one Tandem decision.",
    "Process the answer without sending a message to the parent chat, opening a",
    "canvas, or editing .tandem files. The extension owns Tandem persistence.",
    "",
    `Target project root: ${args.projectRoot}`,
    `Prototype ID: ${args.prototypeId}`,
    `Question ID: ${args.question.id}`,
    `Question: ${args.question.text}`,
    `Answer: ${args.answer}`,
    `Action: ${args.action}`,
    "",
    "Current Tandem state:",
    JSON.stringify(args.state, null, 2),
    "The snapshot may omit historical discussion or mark content truncated.",
    "Read durableStatePath when more evidence is needed; do not write that file.",
    "",
    ...actionInstructions[args.action],
    "",
    "Treat the answer as an authoritative product decision. Update project files",
    "only when the decision requires a prototype change, following the existing",
    "stack and keeping production integrations, tests, and polish out of scope.",
    "Perform a targeted validation after code changes.",
    "Do not advance or complete lifecycle stages. Stage completion is explicit and",
    "owned by Tandem after the active stage meets its completion criteria.",
    "Return prototypeApproach unchanged unless the latest requirement answer",
    "changes whether Tandem should build a new GUI, validate an existing GUI,",
    "or bypass runtime prototyping because no GUI is needed. Use mode undecided,",
    "build, validate-existing, or not-applicable and provide a concise",
    "user-facing reason.",
    "While lifecycle.currentStage is requirements, do not edit prototype files or",
    "publish a preview. Preserve and return the complete requirements object. During",
    "usage intake, the extension creates the intake question from suggestions. Once",
    "the DAG is fully answered, leave question null and report that requirements are",
    "ready to be completed.",
    "",
    "Return prototypeReview matching the schema, including only the active revision",
    "and newly collected evidence. The extension preserves all earlier history.",
    "Return the ledger and lifecycle state matching the",
    "output schema. Return only changed or new artifacts in artifactChanges.upsert",
    "and IDs intentionally removed in artifactChanges.remove; leave both arrays",
    "empty when artifacts are unchanged. Each upsert must contain the complete",
    "replacement artifact even when the input snapshot was marked as truncated.",
    "Artifacts must be concise synthesized intents, models, contracts, or Mermaid",
    "workflows rather than pasted source. Ask exactly one next high-impact question,",
    "or return null when implementation/iteration can proceed without another",
    "decision. Preserve the current preview URL and status unless you have verified",
    "a replacement.",
    "Every artifact upsert must set stage to requirements, prototype, design, plan,",
    "or implement according to the lifecycle stage that owns the result.",
    "Preserve all prior prototypeReview revisions, clarifications, and evidence.",
    "Every question must offer 3 to 5 carefully selected, mutually distinct choices",
    "that span the important decision space without a generic catch-all. Put the",
    "recommended default first and set recommended to that exact choice so the user",
    "can submit it without entering text. Keep free text available for overrides.",
    "Return a complete decisionGraph whose nodes are the source of truth for question",
    "selection during Requirements only. Outside Requirements preserve it unchanged.",
    "Never omit an existing node or invent an answer. Only the extension applies the submitted answer;",
    "independent and previously confirmed decisions must retain their IDs, answers, and prerequisites.",
    "selection. Each node id is also its question id. dependencies contains parent",
    "node ids that must be answered first. Include the submitted answer on its node.",
    "A node with every dependency answered must include its question and curated",
    "choices so it can be promoted. Keep independent decisions as separate nodes.",
    "Exactly one unanswered eligible node is active at a time; all other unanswered",
    "nodes are toAnswer. Set question to the active node only; after it is answered,",
    "promote the next eligible toAnswer node to active.",
    "",
    "During Requirements maintain a single artifact with id design-tree, title Design tree,",
    "kind design-tree, stage requirements, and language mermaid. Model decisions as",
    "a prerequisite DAG using flowchart LR: preserve answered branches, shared",
    "prerequisites, the active decision, and known downstream decisions. Style nodes",
    "with Mermaid classes answered, active, and toAnswer. Use solid green styling",
    "for answered, solid blue styling for active, and amber styling for toAnswer.",
    "Exactly one node may be active. Its content must briefly explain the user's",
    "current location. Update this artifact after every answer, including when the",
    "design is confirmed and implementation becomes current."
  ].join("\n");
}
function designReviewFactoryPrompt(args) {
  const thread = args.thread;
  const isTestDesign = args.reviewKind === "test";
  const task = args.action === "finalize" ? [
    isTestDesign ? "Synthesize the integration and interaction test specification from the resolved discussion and current design." : "Synthesize the product design specification from the resolved discussion and current Design artifacts.",
    "Return exactly one artifact with id",
    isTestDesign ? "test-spec, title Test specification, kind test-spec, stage design," : "design-spec, title Design specification, kind design-spec, stage design,",
    "language markdown, empty path and Mermaid, reviewStatus current, and",
    "sourceThreadIds containing every resolved thread ID. Cover accepted",
    isTestDesign ? "integration boundaries, interaction journeys, fixtures, setup, test data, observable outcomes, failure evidence, and coverage risks." : "decisions, architecture, contracts, interaction behavior, risks, tradeoffs, validation expectations, and remaining constraints.",
    isTestDesign ? "Also return structured testScenarios. Include both integration and interaction scenarios where applicable, stable IDs, true dependencies, executable steps, expected outcomes, and concrete validation guidance." : "Return an empty testScenarios array."
  ] : [
    `Request type: ${thread.type}`,
    `Requested artifact kind: ${thread.artifactKind || "none"}`,
    `Artifact under review: ${thread.reviewArtifactId || "none"}`,
    `User request: ${thread.prompt}`,
    "",
    "Inspect the existing project when useful. Answer the request directly using",
    "the draft feature specification, resolved discussion, repository structure,",
    "and existing artifacts as evidence. If the request",
    isTestDesign ? "asks for a test-design artifact, return one or more useful artifacts. An" : "asks for a design artifact, return one or more useful artifacts. An",
    "artifact request must return at least one artifact of the requested",
    "kind. A normal question may also return an artifact when it materially",
    "improves the explanation."
  ];
  return [
    `You are the hidden ${isTestDesign ? "Test Design" : "Product Design"} Review worker for Tandem.`,
    "Do not message the parent chat, open canvases, edit project files, or advance",
    "the lifecycle. Return only the structured output required by the schema.",
    "",
    `Prototype ID: ${args.prototypeId}`,
    `Project root: ${args.projectRoot}`,
    `Action: ${args.action}`,
    `Design substage: ${args.reviewKind}`,
    "",
    "Current Tandem state:",
    JSON.stringify(args.state, null, 2),
    "",
    ...task,
    "",
    "Every returned artifact must use stage design, reviewStatus current, and a",
    "complete stable ID. For a thread request, sourceThreadIds must contain that",
    "thread ID. Use Mermaid for requested diagrams and put valid diagram source in",
    "mermaid. Use concise Markdown content to explain every artifact. Contracts",
    "should capture typed boundaries without inventing production infrastructure.",
    "Decision records should state context, decision, alternatives, and consequences.",
    "For non-finalization requests, return an empty testScenarios array.",
    "The answer should explain the result and name any generated artifacts."
  ].join("\n");
}
function planningFactoryPrompt(args) {
  return [
    "You are the hidden execution-planning worker for Tandem.",
    "Do not implement code, edit files, message the parent chat, open canvases, or",
    "advance the lifecycle. Return only the structured output required by the schema.",
    "",
    `Prototype ID: ${args.prototypeId}`,
    `Maximum parallel agents: ${args.maxAgents}`,
    `Action: ${args.action}`,
    `Revision instruction: ${args.instruction || "Create the initial execution plan."}`,
    "",
    "Current Tandem state:",
    JSON.stringify(args.state, null, 2),
    "",
    "Create an efficient implementation plan grounded in the accepted design-spec,",
    "test-spec, draft feature specification, contracts, architecture, and repository.",
    "Divide the work into the smallest independently implementable units that still",
    "produce coherent, reviewable changes. Minimize dependencies and expose the widest",
    "safe frontier without inventing artificial parallelism.",
    "",
    "For each work item provide a stable kebab-case ID, precise outcome, prerequisite",
    "IDs, one agent role, realistic effort hours, owned workspace-relative files or",
    "directories, required skills, observable acceptance criteria, and existing",
    "validation commands or checks. Reserve execution of integration and interaction",
    "scenarios from test-spec for the post-implementation Test stage; implementation",
    "work may still create required harnesses or testability seams. Work items that can run together should not claim",
    "the same files. Use dependencies only when one item truly consumes another's",
    "output. Include integration and final validation work where necessary.",
    "",
    "The extension computes dependency waves, file-conflict scheduling, agent slots,",
    "critical path, and parallelism savings from your work items. Ensure every",
    "dependency names another returned item, the graph is acyclic, and all required",
    "implementation scope is covered. The strategy must explain orchestration, merge",
    "order, integration points, and how agents coordinate handoffs."
  ].join("\n");
}
function factoryErrorMessage(run) {
  if (run.error) return run.error;
  if (run.failure?.message) return run.failure.message;
  if (run.reason) return run.reason;
  return `Factory run ended with status "${run.status}".`;
}
function factoryErrorCode(error) {
  return error?.code || error?.data?.code || null;
}
async function recordFactoryRunId(prototypeId, requestId, runId, factoryName = ANSWER_FACTORY_NAME, generation) {
  return withAnswerClaim(prototypeId, async () => {
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      return false;
    }
    const current = await loadState(prototypeId);
    if (current.processing?.status !== "running" || current.processing.requestId !== requestId || generation !== void 0 && current.generation !== generation || current.processing.runId && current.processing.runId !== runId && current.processing.factoryName === factoryName) {
      return false;
    }
    const next = {
      ...current,
      processing: {
        ...current.processing,
        factoryName,
        runId,
        message: current.processing.action === "build-prototype" ? "The prototype worker is building and launching the runnable preview." : current.processing.message
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
}
async function applyFactoryResult(prototypeId, requestId, run) {
  if (run.status !== "completed" || !isObject(run.result)) {
    throw new Error(factoryErrorMessage(run));
  }
  let completePrototype = false;
  await withAnswerClaim(prototypeId, async () => {
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      return;
    }
    const current = await loadState(prototypeId);
    if (current.processing?.status !== "running" || current.processing.requestId !== requestId || !current.processing.runId || current.processing.runId !== run.runId) {
      await logSafely("Ignored a result that does not own the active Tandem request.", "warning");
      return;
    }
    const result = run.result;
    const previewUrl = normalizePreviewUrl(result.previewUrl);
    if (previewUrl && previewUrl !== current.previewUrl) {
      await verifyPreviewIdentity(previewUrl, prototypeId);
    }
    const phase = ["discovery", "building", "iterating", "complete"].includes(
      result.phase
    ) ? result.phase : current.phase;
    const previewStatus = ["waiting", "starting", "ready", "error"].includes(
      result.previewStatus
    ) ? result.previewStatus : current.previewStatus;
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    let decisionGraph = current.lifecycle.currentStage === "requirements" ? normalizeDecisionGraph(result.decisionGraph, result.question) : current.decisionGraph;
    const action = current.processing.action || "answer-decision";
    if (action === "build-prototype") {
      if (!previewUrl || previewStatus !== "ready") throw new Error("Prototype creation did not return a running preview. Retry the build to continue.");
      await verifyPreviewIdentity(previewUrl, prototypeId);
    }
    if (action === "generate-dag") {
      const graphError = generatedDecisionGraphError(
        decisionGraph,
        current.prototypeApproach.mode === "undecided"
      );
      if (graphError) throw new Error(graphError);
      if (decisionGraph.nodes.some((node) => node.answer)) {
        throw new Error("New requirements must be answered by the user, not by the worker.");
      }
    }
    const answeredQuestionId = current.processing.question?.id;
    if (["answer-decision", "change-answer"].includes(action) && answeredQuestionId) {
      decisionGraph = normalizeDecisionGraph(applyAuthoritativeAnswer(
        current.decisionGraph,
        decisionGraph,
        answeredQuestionId,
        current.processing.answer,
        action === "change-answer"
      ));
    }
    let requirements = normalizeRequirements(
      result.requirements,
      decisionGraph
    );
    if (action === "add-usage" && current.processing.answer) {
      requirements = normalizeRequirements(
        {
          ...requirements,
          substage: "usage",
          usageItems: [
            ...current.requirements.usageItems,
            current.processing.answer
          ]
        },
        { nodes: [] }
      );
      decisionGraph = { nodes: [] };
    } else if (action === "generate-dag") {
      requirements = normalizeRequirements(
        {
          ...requirements,
          substage: "dag",
          usageItems: current.requirements.usageItems,
          suggestions: []
        },
        decisionGraph
      );
    } else {
      requirements = current.requirements;
    }
    if (current.lifecycle.currentStage !== "requirements") decisionGraph = current.decisionGraph;
    let prototypeReview = normalizePrototypeReview(result.prototypeReview);
    const returnedRevisions = prototypeReview.revisions;
    prototypeReview.revisions = current.prototypeReview.revisions.map((revision) => {
      const update = returnedRevisions.find((candidate) => candidate.id === revision.id);
      if (!update || revision.id !== current.prototypeReview.activeRevisionId) return revision;
      return {
        ...revision,
        ...update,
        suggestion: revision.suggestion,
        submittedAt: revision.submittedAt,
        clarifications: [
          ...revision.clarifications,
          ...update.clarifications.filter((entry) => !revision.clarifications.some(
            (previous) => previous.question === entry.question && previous.answer === entry.answer
          ))
        ]
      };
    });
    prototypeReview.evidence = [
      ...current.prototypeReview.evidence,
      ...prototypeReview.evidence.filter((entry) => !current.prototypeReview.evidence.some((previous) => previous.id === entry.id))
    ].slice(-100);
    if (["submit-revision", "clarify-revision"].includes(action)) {
      const questionError = revisionQuestionError(prototypeReview.question);
      if (questionError) throw new Error(questionError);
      const activeRevisionId = current.prototypeReview.activeRevisionId;
      const revision = prototypeReview.revisions.find(
        (candidate) => candidate.id === activeRevisionId
      );
      if (!revision) {
        throw new Error(
          "The hidden agent did not return the active prototype revision."
        );
      }
      if (action === "clarify-revision" && current.processing.question) {
        const clarification = {
          question: current.processing.question.text,
          answer: current.processing.answer
        };
        if (!revision.clarifications.some(
          (entry) => entry.question === clarification.question && entry.answer === clarification.answer
        )) {
          revision.clarifications.push(clarification);
        }
      }
      if (prototypeReview.question) {
        revision.status = "clarifying";
        prototypeReview.activeRevisionId = revision.id;
        revision.completedAt = null;
      } else {
        revision.status = "applied";
        prototypeReview.activeRevisionId = null;
        revision.completedAt = completedAt;
        if (!revision.summary) {
          revision.summary = "Applied the requested prototype revision.";
        }
        if (prototypeReview.evidence.length <= current.prototypeReview.evidence.length && !prototypeReview.evidence.some(
          (entry) => entry.id === `revision-${revision.id}`
        )) {
          prototypeReview.evidence.push({
            id: `revision-${revision.id}`,
            type: "revision",
            content: revision.summary,
            recordedAt: completedAt
          });
        }
      }
    }
    const artifacts = applyArtifactChanges(
      current.artifacts,
      isObject(result.artifactChanges) ? {
        ...result.artifactChanges,
        upsert: Array.isArray(result.artifactChanges.upsert) ? result.artifactChanges.upsert.map((artifact) => ({ ...artifact, sourceRevision: current.revision })) : result.artifactChanges.upsert
      } : result.artifactChanges
    );
    if (action === "generate-design-spec") {
      const designSpec = artifacts.find(
        (artifact) => artifact.id === "draft-feature-spec" && artifact.kind === "feature-spec" && artifact.stage === "prototype" && artifact.content.trim()
      );
      if (!designSpec) {
        throw new Error(
          "Prototype completion did not produce a valid draft feature specification."
        );
      }
      prototypeReview = {
        ...prototypeReview,
        question: null,
        activeRevisionId: null,
        designSpecArtifactId: designSpec.id
      };
      completePrototype = true;
    }
    const prototypeApproach = current.lifecycle.currentStage === "requirements" && ["answer-decision", "change-answer"].includes(action) && answeredQuestionId === "prototype-approach" ? normalizePrototypeApproach(result.prototypeApproach) : current.prototypeApproach;
    if (["answer-decision", "change-answer"].includes(action) && answeredQuestionId === "prototype-approach" && prototypeApproach.mode === "undecided") {
      throw new Error(
        "The prototype-approach answer did not resolve the interface-validation mode."
      );
    }
    const next = {
      ...current,
      goal: current.goal,
      phase: action === "build-prototype" ? "iterating" : phase,
      status: action === "build-prototype" ? "The prototype is ready for review." : typeof result.status === "string" ? result.status.trim().slice(0, 1e3) : "The hidden agent processed the latest decision.",
      prototypeApproach,
      requirements,
      question: requirements.substage === "usage" ? usageQuestion(requirements.suggestions) : firstActiveQuestion(decisionGraph) || normalizeQuestion(result.question),
      decisionGraph,
      prototypeReview,
      confirmed: current.lifecycle.currentStage === "requirements" ? decisionGraph.nodes.filter((node) => node.answer).map((node) => `${node.title}: ${node.answer}`) : current.confirmed,
      assumed: current.lifecycle.currentStage === "requirements" ? normalizeStringList(result.assumed) : current.assumed,
      deferred: current.lifecycle.currentStage === "requirements" ? normalizeStringList(result.deferred) : current.deferred,
      artifacts,
      previewUrl,
      previewStatus,
      suggestionProcessing: action === "generate-dag" ? null : current.suggestionProcessing,
      processing: {
        ...current.processing,
        status: "success",
        message: "Processed by a hidden Tandem agent.",
        runId: run.runId,
        completedAt,
        question: null,
        answer: null
      },
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
  if (completePrototype) {
    activePrototypeCompletions.add(prototypeId);
    try {
      await completeLifecycleStage(
        prototypeId,
        "prototype",
        PROVIDER_EXTENSION_ID
      );
    } finally {
      activePrototypeCompletions.delete(prototypeId);
    }
  }
}
async function recordFactoryFailure(prototypeId, requestId, error) {
  await withAnswerClaim(prototypeId, async () => {
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      return;
    }
    const current = await loadState(prototypeId);
    if (current.processing?.status !== "running" || current.processing.requestId !== requestId) {
      return;
    }
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const restoredDecisionGraph = current.processing.action === "change-answer" && current.processing.originalDecisionGraph ? current.processing.originalDecisionGraph : current.decisionGraph;
    const action = current.processing.action;
    const prototypeReview = normalizePrototypeReview(current.prototypeReview);
    if (["submit-revision", "clarify-revision"].includes(action)) {
      const revision = prototypeReview.revisions.find(
        (candidate) => candidate.id === prototypeReview.activeRevisionId
      );
      if (revision) {
        revision.status = action === "clarify-revision" ? "clarifying" : "failed";
        revision.summary = "The prototype revision could not be processed. Retry explicitly.";
        revision.completedAt = action === "submit-revision" ? completedAt : null;
      }
      prototypeReview.question = action === "clarify-revision" ? current.processing.question : null;
      if (action === "submit-revision") {
        prototypeReview.activeRevisionId = null;
      }
    }
    const failed = {
      ...current,
      previewStatus: action === "build-prototype" ? "error" : current.previewStatus,
      decisionGraph: restoredDecisionGraph,
      question: current.requirements.substage === "usage" ? usageQuestion(current.requirements.suggestions) : firstActiveQuestion(restoredDecisionGraph),
      prototypeReview,
      status: `Processing failed: ${error instanceof Error ? error.message : String(error)}`,
      processing: {
        ...current.processing,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        completedAt,
        answer: null
      },
      updatedAt: completedAt
    };
    await persistState(failed);
    publishState(prototypeId);
  });
  await logSafely(
    `Tandem hidden processing failed: ${error instanceof Error ? error.message : String(error)}`
  );
}
async function settleAnswerRun(prototypeId, requestId, run) {
  let terminalRun = run;
  if (!isFactoryRunTerminal(terminalRun.status)) {
    terminalRun = await session.factory.waitForRun(terminalRun.runId);
  }
  if (terminalRun.status === "halted") {
    terminalRun = await resumeHaltedRun(terminalRun.runId);
  }
  await applyFactoryResult(prototypeId, requestId, terminalRun);
}
async function resumeHaltedRun(runId) {
  for (let attempt = 0; attempt < 305; attempt += 1) {
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      throw new Error(
        "This provider no longer owns hidden answer processing."
      );
    }
    try {
      return await session.factory.resume(runId);
    } catch (error) {
      if (error?.code === "already_active") {
        return session.factory.waitForRun(runId);
      }
      if (error?.code !== "factory_already_running") {
        throw error;
      }
      await new Promise((resolve3) => setTimeout(resolve3, 1e3));
      const current = await session.factory.getRun(runId);
      if (current.status === "running") {
        return session.factory.waitForRun(runId);
      }
      if (current.status !== "halted") {
        return current;
      }
    }
  }
  throw new Error("Timed out waiting to resume the hidden factory run.");
}
function trackAnswerRun(prototypeId, requestId, work) {
  const tracked = work.catch(async (error) => {
    try {
      await recordFactoryFailure(prototypeId, requestId, error);
    } catch (recordError) {
      await logSafely(
        `Tandem could not persist a hidden-processing failure: ${recordError instanceof Error ? recordError.message : String(recordError)}`
      );
    }
  }).finally(() => {
    if (activeAnswerRuns.get(prototypeId) === tracked) {
      activeAnswerRuns.delete(prototypeId);
    }
  });
  activeAnswerRuns.set(prototypeId, tracked);
}
function startAnswerFactory(prototypeId, requestId, question, answer, action, state) {
  const work = runAnswerFactory(
    prototypeId,
    requestId,
    question,
    answer,
    action,
    state
  );
  trackAnswerRun(prototypeId, requestId, work);
}
async function runAnswerFactory(prototypeId, requestId, question, answer, action, state) {
  if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
    return;
  }
  const run = await session.rpc.factory.run({
    name: ANSWER_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      requestId,
      question,
      answer,
      action,
      state: factoryStateSnapshot(state)
    }
  });
  const currentRequest = await recordFactoryRunId(
    prototypeId,
    requestId,
    run.runId,
    ANSWER_FACTORY_NAME,
    state.generation
  );
  if (!currentRequest) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  await settleAnswerRun(prototypeId, requestId, run);
}
function recoverAnswerFactory(state, canSubmitAnswers) {
  const processing = state.processing;
  if (!canSubmitAnswers || processing?.status !== "running" || activeAnswerRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    const current = await loadState(state.prototypeId);
    const currentProcessing = current.processing;
    if (currentProcessing?.status !== "running" || currentProcessing.requestId !== processing.requestId) {
      return;
    }
    let run;
    if (currentProcessing.runId) {
      try {
        run = await session.factory.getRun(currentProcessing.runId);
      } catch (error) {
        if (["not_found", "non_resumable"].includes(
          factoryErrorCode(error)
        ) && currentProcessing.factoryName !== ANSWER_FACTORY_NAME && currentProcessing.question && currentProcessing.answer) {
          await runAnswerFactory(
            state.prototypeId,
            currentProcessing.requestId,
            currentProcessing.question,
            currentProcessing.answer,
            currentProcessing.action,
            current
          );
          return;
        }
        throw error;
      }
    } else {
      run = await findAnswerFactoryRun(currentProcessing);
      if (!run) {
        throw new Error(
          "The durable factory run could not be correlated after reload."
        );
      }
      const currentRequest = await recordFactoryRunId(
        state.prototypeId,
        currentProcessing.requestId,
        run.runId,
        currentProcessing.factoryName
      );
      if (!currentRequest) return;
    }
    if (currentProcessing.factoryName !== ANSWER_FACTORY_NAME) {
      if (!isFactoryRunTerminal(run.status)) {
        run = await session.factory.waitForRun(run.runId);
      }
      if (["halted", "cancelled"].includes(run.status)) {
        if (!currentProcessing.question || !currentProcessing.answer) {
          throw new Error(
            "The prior provider stopped before its hidden run could be resumed."
          );
        }
        await runAnswerFactory(
          state.prototypeId,
          currentProcessing.requestId,
          currentProcessing.question,
          currentProcessing.answer,
          currentProcessing.action,
          current
        );
        return;
      }
    }
    await settleAnswerRun(
      state.prototypeId,
      currentProcessing.requestId,
      run
    );
  })();
  trackAnswerRun(state.prototypeId, processing.requestId, work);
}
async function findAnswerFactoryRun(processing) {
  const requestedAt = Date.parse(processing.requestedAt);
  if (!Number.isFinite(requestedAt)) return null;
  const marker = `Request ${processing.requestId};`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runs = await session.factory.listRuns();
    const candidates = runs.filter(
      (run) => run.factoryName === processing.factoryName && run.createdAt >= requestedAt - 1e3 && run.createdAt <= requestedAt + 3e4
    );
    for (const candidate of candidates) {
      const progress = await session.factory.getRunProgress(
        candidate.runId,
        { limit: 500 }
      );
      if (progress.records.some((record) => record.text.includes(marker))) {
        return session.factory.getRun(candidate.runId);
      }
    }
    await new Promise((resolve3) => setTimeout(resolve3, 1e3));
  }
  return null;
}
function trackSuggestionRun(prototypeId, requestId, work) {
  const tracked = work.catch(async (error) => {
    await recordSuggestionFailure(prototypeId, requestId, error);
  }).finally(() => {
    if (activeSuggestionRuns.get(prototypeId) === tracked) {
      activeSuggestionRuns.delete(prototypeId);
    }
  });
  activeSuggestionRuns.set(prototypeId, tracked);
}
function startSuggestionFactory(prototypeId, requestId, goal, usageItems) {
  trackSuggestionRun(
    prototypeId,
    requestId,
    runSuggestionFactory(prototypeId, requestId, goal, usageItems)
  );
}
async function ensureUsageSuggestionsStarted(state, canSubmitAnswers) {
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "requirements" || state.requirements.substage !== "usage" || state.requirements.suggestions.length > 0 || state.suggestionProcessing || activeSuggestionRuns.has(state.prototypeId)) {
    return state;
  }
  let request = null;
  const nextState = await withAnswerClaim(state.prototypeId, async () => {
    const current = await loadState(state.prototypeId);
    if (current.lifecycle.currentStage !== "requirements" || current.requirements.substage !== "usage" || current.requirements.suggestions.length > 0 || current.suggestionProcessing || current.processing?.status === "running") {
      return current;
    }
    const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
    const requestId = randomUUID3();
    const usageItems = [...current.requirements.usageItems];
    const next = {
      ...current,
      status: usageItems.length === 0 ? "Generating starter usage suggestions in the background..." : "Generating usage suggestions in the background...",
      suggestionProcessing: {
        status: "running",
        message: "Generating suggestions without blocking usage entry.",
        requestId,
        factoryName: SUGGESTION_FACTORY_NAME,
        runId: null,
        usageItems,
        requestedAt,
        completedAt: null
      },
      updatedAt: requestedAt
    };
    await persistState(next);
    publishState(current.prototypeId);
    request = {
      prototypeId: current.prototypeId,
      requestId,
      goal: current.goal,
      usageItems
    };
    return next;
  });
  if (request) {
    startSuggestionFactory(
      request.prototypeId,
      request.requestId,
      request.goal,
      request.usageItems
    );
  }
  return nextState;
}
async function runSuggestionFactory(prototypeId, requestId, goal, usageItems) {
  if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) return;
  const run = await session.rpc.factory.run({
    name: SUGGESTION_FACTORY_NAME,
    args: {
      prototypeId,
      requestId,
      goal,
      usageItems
    }
  });
  const currentRequest = await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (current.suggestionProcessing?.status !== "running" || current.suggestionProcessing.requestId !== requestId) {
      return false;
    }
    const next = {
      ...current,
      suggestionProcessing: {
        ...current.suggestionProcessing,
        runId: run.runId
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
  if (!currentRequest) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  let terminalRun = run;
  if (!isFactoryRunTerminal(terminalRun.status)) {
    terminalRun = await session.factory.waitForRun(terminalRun.runId);
  }
  if (terminalRun.status === "halted") {
    terminalRun = await resumeHaltedRun(terminalRun.runId);
  }
  if (terminalRun.status !== "completed" || !isObject(terminalRun.result)) {
    throw new Error(factoryErrorMessage(terminalRun));
  }
  await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (current.suggestionProcessing?.status !== "running" || current.suggestionProcessing.requestId !== requestId || current.requirements.substage !== "usage") {
      return;
    }
    const requirements = normalizeRequirements(
      {
        ...current.requirements,
        suggestions: terminalRun.result.suggestions
      },
      current.decisionGraph
    );
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const next = {
      ...current,
      requirements,
      question: usageQuestion(requirements.suggestions),
      status: "Suggestions are ready. Keep adding usages or generate the DAG.",
      suggestionProcessing: {
        ...current.suggestionProcessing,
        status: "success",
        message: "Suggestions updated.",
        completedAt
      },
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function recordSuggestionFailure(prototypeId, requestId, error) {
  await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    if (current.suggestionProcessing?.status !== "running" || current.suggestionProcessing.requestId !== requestId) {
      return;
    }
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const hasUsages = current.requirements.usageItems.length > 0;
    const next = {
      ...current,
      status: hasUsages ? "Usage saved, but suggestions could not be refreshed." : "Starter suggestions could not be generated. Add a usage to continue.",
      suggestionProcessing: {
        ...current.suggestionProcessing,
        status: "error",
        message: hasUsages ? "Suggestion generation failed. Add another usage to retry." : "Suggestion generation failed. Add a usage to retry.",
        completedAt
      },
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
  await logSafely(
    `Tandem suggestion generation failed: ${error instanceof Error ? error.message : String(error)}`
  );
}
function recoverSuggestionFactory(state, canSubmitAnswers) {
  const processing = state.suggestionProcessing;
  if (!canSubmitAnswers || processing?.status !== "running" || activeSuggestionRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    if (processing.runId) {
      try {
        let run = await session.factory.getRun(processing.runId);
        if (!isFactoryRunTerminal(run.status)) {
          run = await session.factory.waitForRun(run.runId);
        }
        if (run.status === "halted") {
          run = await resumeHaltedRun(run.runId);
        }
        if (run.status !== "completed" || !isObject(run.result)) {
          throw new Error(factoryErrorMessage(run));
        }
        await withAnswerClaim(state.prototypeId, async () => {
          const current = await loadState(state.prototypeId);
          if (current.suggestionProcessing?.requestId !== processing.requestId) {
            return;
          }
          const requirements = normalizeRequirements(
            {
              ...current.requirements,
              suggestions: run.result.suggestions
            },
            current.decisionGraph
          );
          const completedAt = (/* @__PURE__ */ new Date()).toISOString();
          const next = {
            ...current,
            requirements,
            question: usageQuestion(requirements.suggestions),
            status: "Suggestions are ready. Keep adding usages or generate the DAG.",
            suggestionProcessing: {
              ...current.suggestionProcessing,
              status: "success",
              message: "Suggestions updated.",
              completedAt
            },
            updatedAt: completedAt
          };
          await persistState(next);
          publishState(state.prototypeId);
        });
        return;
      } catch (error) {
        if (!["not_found", "non_resumable"].includes(factoryErrorCode(error))) {
          throw error;
        }
      }
    }
    await runSuggestionFactory(
      state.prototypeId,
      processing.requestId,
      state.goal,
      processing.usageItems
    );
  })();
  trackSuggestionRun(state.prototypeId, processing.requestId, work);
}
function applyArtifactChanges(currentArtifacts, value) {
  if (!isObject(value)) {
    throw new Error("The hidden agent returned invalid artifact changes.");
  }
  if (!Array.isArray(value.upsert) || value.upsert.length > 30) {
    throw new Error("The hidden agent returned too many artifact upserts.");
  }
  if (!Array.isArray(value.remove) || value.remove.length > 50) {
    throw new Error("The hidden agent returned invalid artifact removals.");
  }
  const upsertIds = /* @__PURE__ */ new Set();
  for (const artifact of value.upsert) {
    if (!isValidFactoryArtifact(artifact) || upsertIds.has(artifact.id)) {
      throw new Error("The hidden agent returned an invalid artifact upsert.");
    }
    upsertIds.add(artifact.id);
  }
  for (const id of value.remove) {
    if (typeof id !== "string" || id !== id.trim() || !id || id.length > 120) {
      throw new Error("The hidden agent returned an invalid artifact removal.");
    }
  }
  const removedIds = new Set(normalizeStringList(value.remove));
  const merged = currentArtifacts.filter(
    (artifact) => !removedIds.has(artifact.id)
  );
  const upserts = normalizeArtifacts(value.upsert);
  if (upserts.length !== value.upsert.length) {
    throw new Error("The hidden agent returned an invalid artifact upsert.");
  }
  for (const artifact of upserts) {
    const index = merged.findIndex((candidate) => candidate.id === artifact.id);
    if (index === -1) {
      if (merged.length >= 30) {
        throw new Error(
          "The hidden agent must remove an artifact before adding another."
        );
      }
      merged.push(artifact);
    } else {
      merged[index] = artifact;
    }
  }
  return merged;
}
function isValidFactoryArtifact(value) {
  if (!isObject(value)) return false;
  const limits = {
    id: 120,
    title: 200,
    kind: 80,
    stage: 20,
    path: 500,
    language: 80,
    content: 2e5,
    mermaid: 5e4
  };
  for (const [field, limit] of Object.entries(limits)) {
    if (typeof value[field] !== "string" || value[field].length > limit) {
      return false;
    }
  }
  for (const field of [
    "id",
    "title",
    "kind",
    "stage",
    "path",
    "language",
    "mermaid"
  ]) {
    if (value[field] !== value[field].trim()) return false;
  }
  return Boolean(
    value.id && value.title && value.kind && LIFECYCLE_STAGES.some((stage) => stage.id === value.stage) && value.language
  );
}
function designReviewContext(state) {
  const productReview = normalizeDesignReview(state.designReview);
  const design = normalizeDesign(state.design, productReview);
  const reviewKind = design.substage === "test" ? "test" : "product";
  const reviewKey = reviewKind === "test" ? "testDesignReview" : "designReview";
  return {
    design,
    reviewKind,
    reviewKey,
    review: normalizeDesignReview(state[reviewKey])
  };
}
function seedDefaultProductDesignReview(state, createdAt = (/* @__PURE__ */ new Date()).toISOString()) {
  if (state.lifecycle.currentStage !== "design" || state.design?.substage === "test") {
    return state;
  }
  const review = normalizeDesignReview(state.designReview);
  if (review.threads.length > 0 || review.processing || review.finalizeRequested || review.finalizedArtifactId) {
    return state;
  }
  return {
    ...state,
    designReview: {
      ...review,
      threads: DEFAULT_PRODUCT_DESIGN_REQUESTS.map((request) => ({
        id: request.id,
        type: "artifact",
        artifactKind: request.artifactKind,
        prompt: request.prompt,
        answer: "",
        status: "queued",
        artifactIds: [],
        reviewArtifactId: null,
        createdAt,
        completedAt: null,
        error: ""
      }))
    },
    status: "Generating required project-specific design artifacts for review...",
    updatedAt: createdAt
  };
}
async function ensureDefaultProductDesignReview(state, canSubmitAnswers) {
  if (!canSubmitAnswers) return state;
  return withAnswerClaim(state.prototypeId, async () => {
    const current = await loadState(state.prototypeId);
    const next = seedDefaultProductDesignReview(current);
    if (next === current) return current;
    await persistState(next);
    publishState(state.prototypeId);
    return next;
  });
}
function markDesignArtifactsStale(artifacts, threadId = null, reviewKind = "product") {
  return artifacts.map((artifact) => {
    const dependsOnThread = threadId && artifact.sourceThreadIds.includes(threadId);
    const isFinalArtifact = reviewKind === "test" ? artifact.id === "test-spec" : ["design-spec", "design-review", "test-spec"].includes(
      artifact.id
    );
    if (artifact.stage !== "design" || !isFinalArtifact && !dependsOnThread) {
      return artifact;
    }
    return { ...artifact, reviewStatus: "stale" };
  });
}
async function applyDesignReviewFactoryResult(prototypeId, requestId, run) {
  if (run.status !== "completed" || !isObject(run.result)) {
    throw new Error(factoryErrorMessage(run));
  }
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const context = designReviewContext(state);
    const review = context.review;
    if (!review.processing || review.processing.requestId !== requestId) {
      return;
    }
    const result = run.result;
    const answer = String(result.answer || "").trim().slice(0, 2e4);
    if (!answer || !Array.isArray(result.artifacts)) {
      throw new Error("The Design Review worker returned an invalid result.");
    }
    for (const artifact of result.artifacts) {
      if (!isValidFactoryArtifact(artifact) || artifact.stage !== "design" || !Array.isArray(artifact.sourceThreadIds) || artifact.reviewStatus !== "current") {
        throw new Error(
          "The Design Review worker returned an invalid artifact."
        );
      }
    }
    const artifacts = applyArtifactChanges(state.artifacts, {
      upsert: result.artifacts,
      remove: []
    });
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    let finalizedArtifactId = review.finalizedArtifactId;
    let finalizeRequested = review.finalizeRequested;
    const threads = review.threads.map((thread) => ({ ...thread }));
    let status;
    if (review.processing.action === "finalize") {
      const unresolved = threads.some((thread) => thread.status !== "resolved");
      if (!finalizeRequested || unresolved) {
        const next2 = {
          ...state,
          [context.reviewKey]: {
            ...review,
            processing: null,
            finalizeRequested: false,
            finalizedArtifactId: null
          },
          status: "The final review was superseded by a newer design question.",
          updatedAt: completedAt
        };
        await persistState(next2);
        publishState(prototypeId);
        return;
      }
      const finalArtifact = artifacts.find(
        (artifact) => artifact.id === (context.reviewKind === "test" ? "test-spec" : "design-spec") && artifact.kind === (context.reviewKind === "test" ? "test-spec" : "design-spec") && artifact.stage === "design" && artifact.reviewStatus === "current" && artifact.content.trim()
      );
      if (!finalArtifact) {
        throw new Error(
          `The ${context.reviewKind} design worker did not produce its final specification.`
        );
      }
      const scenarios = context.reviewKind === "test" ? normalizeTestScenarios(result.testScenarios) : review.scenarios;
      if (context.reviewKind === "test" && scenarios.length === 0) {
        throw new Error(
          "The Test Design worker did not return executable test scenarios."
        );
      }
      finalizedArtifactId = finalArtifact.id;
      finalizeRequested = false;
      status = context.reviewKind === "test" ? "Test specification captured. Design can now be completed." : "Design specification captured. Continue with Test design.";
      review.scenarios = scenarios;
    } else {
      const threadId = review.processing.threadId;
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) {
        throw new Error("The active Design Review thread no longer exists.");
      }
      const generatedArtifacts = artifacts.filter(
        (artifact) => result.artifacts.some(
          (candidate) => candidate.id === artifact.id
        ) && artifact.sourceThreadIds.includes(thread.id)
      );
      if (thread.type === "artifact" && generatedArtifacts.length === 0) {
        throw new Error(
          "The Design Review worker did not generate the requested artifact."
        );
      }
      thread.answer = answer;
      thread.status = "answered";
      thread.artifactIds = generatedArtifacts.map((artifact) => artifact.id);
      thread.completedAt = completedAt;
      thread.error = "";
      status = generatedArtifacts.length > 0 ? `Design answer ready with ${generatedArtifacts.length} artifact${generatedArtifacts.length === 1 ? "" : "s"}.` : "Design answer ready for review.";
    }
    const next = {
      ...state,
      artifacts,
      design: review.processing.action === "finalize" && context.reviewKind === "product" ? { substage: "test" } : context.design,
      [context.reviewKey]: {
        threads,
        processing: null,
        finalizeRequested,
        finalizedArtifactId,
        scenarios: review.scenarios
      },
      testing: review.processing.action === "finalize" && context.reviewKind === "test" ? normalizeTesting(
        { status: "idle" },
        { ...review, scenarios: review.scenarios }
      ) : state.testing,
      status,
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function recordDesignReviewFailure(prototypeId, requestId, error) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const context = designReviewContext(state);
    const review = context.review;
    if (!review.processing || review.processing.requestId !== requestId) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const threads = review.threads.map(
      (thread) => thread.id === review.processing.threadId ? {
        ...thread,
        status: "failed",
        error: message.slice(0, 1e3),
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      } : thread
    );
    const next = {
      ...state,
      [context.reviewKey]: {
        threads,
        processing: null,
        finalizeRequested: false,
        finalizedArtifactId: review.finalizedArtifactId,
        scenarios: review.scenarios
      },
      status: `${context.reviewKind === "test" ? "Test Design" : "Product Design"} processing failed: ${message}`,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function claimNextDesignReviewJob(prototypeId) {
  return withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const context = designReviewContext(state);
    const review = context.review;
    if (state.lifecycle.currentStage !== "design" || review.processing) {
      return null;
    }
    const queuedThread = review.threads.find(
      (thread) => thread.status === "queued"
    );
    const action = queuedThread ? "process-thread" : review.finalizeRequested ? "finalize" : null;
    if (!action) return null;
    const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
    const requestId = randomUUID3();
    const threads = review.threads.map(
      (thread) => thread.id === queuedThread?.id ? { ...thread, status: "processing", error: "" } : thread
    );
    const processing = {
      requestId,
      action,
      threadId: queuedThread?.id || null,
      runId: null,
      requestedAt
    };
    const pending = {
      ...state,
      [context.reviewKey]: {
        ...review,
        threads,
        processing
      },
      status: action === "finalize" ? `Synthesizing the final ${context.reviewKind} design specification...` : `Answering a ${context.reviewKind} design request...`,
      updatedAt: requestedAt
    };
    await persistState(pending);
    publishState(prototypeId);
    return {
      requestId,
      action,
      thread: queuedThread ? threads.find((thread) => thread.id === queuedThread.id) : null,
      state: pending,
      reviewKind: context.reviewKind
    };
  });
}
async function runDesignReviewJob(prototypeId, job) {
  const run = await session.rpc.factory.run({
    name: DESIGN_REVIEW_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      requestId: job.requestId,
      action: job.action,
      reviewKind: job.reviewKind,
      thread: job.thread,
      state: factoryStateSnapshot(job.state)
    }
  });
  const accepted = await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const context = designReviewContext(state);
    if (context.reviewKind !== job.reviewKind) return false;
    const review = context.review;
    if (review.processing?.requestId !== job.requestId) return false;
    const next = {
      ...state,
      [context.reviewKey]: {
        ...review,
        processing: {
          ...review.processing,
          runId: run.runId
        }
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
  if (!accepted) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  const terminalRun = isFactoryRunTerminal(run.status) ? run : await session.factory.waitForRun(run.runId);
  await applyDesignReviewFactoryResult(
    prototypeId,
    job.requestId,
    terminalRun
  );
}
async function processDesignReviewQueue(prototypeId) {
  while (await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
    const job = await claimNextDesignReviewJob(prototypeId);
    if (!job) return;
    try {
      await runDesignReviewJob(prototypeId, job);
    } catch (error) {
      await recordDesignReviewFailure(
        prototypeId,
        job.requestId,
        error
      );
    }
  }
}
function startDesignReviewQueue(prototypeId) {
  if (activeDesignReviewRuns.has(prototypeId)) return;
  const work = processDesignReviewQueue(prototypeId).catch(
    (error) => logSafely(
      `Tandem Design Review queue failed: ${error instanceof Error ? error.message : String(error)}`
    )
  ).finally(() => {
    if (activeDesignReviewRuns.get(prototypeId) === work) {
      activeDesignReviewRuns.delete(prototypeId);
      void loadState(prototypeId).then((state) => {
        const review = designReviewContext(state).review;
        if (state.lifecycle.currentStage === "design" && (review.finalizeRequested || review.threads.some(
          (thread) => thread.status === "queued"
        ))) {
          startDesignReviewQueue(prototypeId);
        }
      }).catch(
        (error) => logSafely(
          `Tandem could not inspect the Design Review queue: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  });
  activeDesignReviewRuns.set(prototypeId, work);
}
function recoverDesignReviewFactory(state, canSubmitAnswers) {
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "design" || activeDesignReviewRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    const current = await loadState(state.prototypeId);
    let context = designReviewContext(current);
    let review = context.review;
    if (review.processing?.runId) {
      try {
        let run = await session.factory.getRun(review.processing.runId);
        if (!isFactoryRunTerminal(run.status)) {
          run = await session.factory.waitForRun(run.runId);
        }
        await applyDesignReviewFactoryResult(
          state.prototypeId,
          review.processing.requestId,
          run
        );
      } catch (error) {
        await recordDesignReviewFailure(
          state.prototypeId,
          review.processing.requestId,
          error
        );
      }
    } else if (review.processing) {
      await withAnswerClaim(state.prototypeId, async () => {
        const latest = await loadState(state.prototypeId);
        context = designReviewContext(latest);
        const latestReview = context.review;
        if (latestReview.processing?.requestId !== review.processing.requestId) {
          return;
        }
        const threads = latestReview.threads.map(
          (thread) => thread.id === latestReview.processing.threadId ? { ...thread, status: "queued" } : thread
        );
        const next = {
          ...latest,
          [context.reviewKey]: {
            ...latestReview,
            threads,
            processing: null
          },
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await persistState(next);
        publishState(state.prototypeId);
      });
    }
    await processDesignReviewQueue(state.prototypeId);
  })().catch(
    (error) => logSafely(
      `Tandem could not recover Design Review: ${error instanceof Error ? error.message : String(error)}`
    )
  ).finally(() => {
    if (activeDesignReviewRuns.get(state.prototypeId) === work) {
      activeDesignReviewRuns.delete(state.prototypeId);
    }
  });
  activeDesignReviewRuns.set(state.prototypeId, work);
}
function markExecutionPlanStale(artifacts) {
  return artifacts.map(
    (artifact) => artifact.stage === "plan" && artifact.id === "execution-plan" ? { ...artifact, reviewStatus: "stale" } : artifact
  );
}
function markFinalCodeStale(artifacts) {
  return artifacts.map(
    (artifact) => artifact.stage === "implement" && artifact.id === "final-code" ? { ...artifact, reviewStatus: "stale" } : artifact
  );
}
function resetImplementationForPlan(planning, previous = {}) {
  if (hasUnconfirmedExecution(previous) || ["starting", "running"].includes(previous.status)) {
    throw new Error("Confirm termination of the previous implementation before replacing its plan or run identity.");
  }
  return normalizeImplementation(
    {
      status: "idle",
      strategySuggestions: Array.isArray(previous.strategySuggestions) ? previous.strategySuggestions.filter(
        (suggestion) => suggestion.status === "queued"
      ) : []
    },
    planning
  );
}
function validatePlanningFactoryResult(result) {
  if (!isObject(result) || !String(result.summary || "").trim() || !String(result.strategy || "").trim() || !Array.isArray(result.workItems) || result.workItems.length === 0) {
    throw new Error("The planning worker returned an incomplete execution plan.");
  }
  const ids = /* @__PURE__ */ new Set();
  for (const item of result.workItems) {
    if (!isObject(item) || !String(item.id || "").trim() || ids.has(item.id) || !String(item.title || "").trim() || !String(item.description || "").trim() || !Array.isArray(item.dependencies) || !Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0 || !Array.isArray(item.validation) || item.validation.length === 0) {
      throw new Error(
        "The planning worker returned an invalid implementation work item."
      );
    }
    ids.add(item.id);
  }
  for (const item of result.workItems) {
    if (item.dependencies.some(
      (dependency) => dependency === item.id || !ids.has(dependency)
    )) {
      throw new Error(
        `Work item ${item.id} contains an invalid dependency.`
      );
    }
  }
}
async function applyPlanningFactoryResult(prototypeId, requestId, run) {
  if (run.status !== "completed" || !isObject(run.result)) {
    throw new Error(factoryErrorMessage(run));
  }
  validatePlanningFactoryResult(run.result);
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    if (planning.processing?.requestId !== requestId) return;
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    const normalized = normalizePlanning({
      ...planning,
      status: "ready",
      summary: run.result.summary,
      strategy: run.result.strategy,
      workItems: run.result.workItems,
      risks: run.result.risks,
      revisionHistory: planning.processing.action === "revise" && planning.processing.instruction ? [
        ...planning.revisionHistory,
        planning.processing.instruction
      ] : planning.revisionHistory,
      processing: null,
      finalizedArtifactId: null,
      error: ""
    });
    if (normalized.error || normalized.waves.length === 0) {
      throw new Error(
        normalized.error || "The execution plan could not be scheduled."
      );
    }
    const next = {
      ...state,
      artifacts: markFinalCodeStale(
        markExecutionPlanStale(state.artifacts)
      ),
      planning: normalized,
      implementation: resetImplementationForPlan(
        normalized,
        state.implementation
      ),
      status: `Execution plan ready: ${normalized.workItems.length} work items across ${normalized.waves.length} wave${normalized.waves.length === 1 ? "" : "s"}.`,
      updatedAt: completedAt
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function recordPlanningFailure(prototypeId, requestId, error) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    if (planning.processing?.requestId !== requestId) return;
    const message = error instanceof Error ? error.message : String(error);
    const next = {
      ...state,
      planning: {
        ...planning,
        status: "failed",
        processing: null,
        error: message.slice(0, 1e3)
      },
      status: `Execution planning failed: ${message}`,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function runPlanningFactory(prototypeId, requestId, state) {
  const planning = normalizePlanning(state.planning);
  const processing = planning.processing;
  if (!processing || processing.requestId !== requestId) return;
  const run = await session.rpc.factory.run({
    name: PLANNING_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      requestId,
      action: processing.action,
      instruction: processing.instruction,
      maxAgents: planning.maxAgents,
      state: factoryStateSnapshot(state)
    }
  });
  const accepted = await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    const currentPlanning = normalizePlanning(current.planning);
    if (currentPlanning.processing?.requestId !== requestId) return false;
    const next = {
      ...current,
      planning: {
        ...currentPlanning,
        processing: {
          ...currentPlanning.processing,
          runId: run.runId
        }
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(prototypeId);
    return true;
  });
  if (!accepted) {
    if (!isFactoryRunTerminal(run.status)) {
      await session.factory.cancel(run.runId);
    }
    return;
  }
  const terminalRun = isFactoryRunTerminal(run.status) ? run : await session.factory.waitForRun(run.runId);
  await applyPlanningFactoryResult(prototypeId, requestId, terminalRun);
}
function startPlanningFactory(prototypeId, requestId, state) {
  if (activePlanningRuns.has(prototypeId)) return;
  const work = runPlanningFactory(prototypeId, requestId, state).catch(async (error) => {
    try {
      await recordPlanningFailure(prototypeId, requestId, error);
    } catch (recordError) {
      await logSafely(
        `Tandem could not persist the planning failure: ${recordError instanceof Error ? recordError.message : String(recordError)}`
      );
    }
  }).finally(() => {
    if (activePlanningRuns.get(prototypeId) === work) {
      activePlanningRuns.delete(prototypeId);
    }
  });
  activePlanningRuns.set(prototypeId, work);
}
function recoverPlanningFactory(state, canSubmitAnswers) {
  const planning = normalizePlanning(state.planning);
  if (!canSubmitAnswers || state.lifecycle.currentStage !== "plan" || !planning.processing || activePlanningRuns.has(state.prototypeId)) {
    return;
  }
  const work = (async () => {
    if (planning.processing.runId) {
      try {
        let run = await session.factory.getRun(planning.processing.runId);
        if (!isFactoryRunTerminal(run.status)) {
          run = await session.factory.waitForRun(run.runId);
        }
        await applyPlanningFactoryResult(
          state.prototypeId,
          planning.processing.requestId,
          run
        );
        return;
      } catch (error) {
        if (!["not_found", "non_resumable"].includes(factoryErrorCode(error))) {
          throw error;
        }
      }
    }
    await runPlanningFactory(
      state.prototypeId,
      planning.processing.requestId,
      state
    );
  })().catch(
    (error) => recordPlanningFailure(
      state.prototypeId,
      planning.processing.requestId,
      error
    )
  ).finally(() => {
    if (activePlanningRuns.get(state.prototypeId) === work) {
      activePlanningRuns.delete(state.prototypeId);
    }
  });
  activePlanningRuns.set(state.prototypeId, work);
}
function executionPlanArtifact(state) {
  const planning = normalizePlanning(state.planning);
  const aliases = new Map(
    planning.workItems.map((item, index) => [item.id, `Work${index + 1}`])
  );
  const mermaid = ["flowchart LR"];
  for (const item of planning.workItems) {
    mermaid.push(
      `  ${aliases.get(item.id)}["${item.title.replace(/"/g, "'")}<br/>${item.agentId}"]`
    );
  }
  for (const item of planning.workItems) {
    for (const dependency of item.dependencies) {
      mermaid.push(
        `  ${aliases.get(dependency)} --> ${aliases.get(item.id)}`
      );
    }
  }
  const lines = [
    "# Execution plan",
    "",
    planning.summary,
    "",
    "## Orchestration strategy",
    "",
    planning.strategy,
    "",
    "## Schedule",
    "",
    `- Work items: ${planning.workItems.length}`,
    `- Agents: ${planning.agents.length}`,
    `- Parallel waves: ${planning.waves.length}`,
    `- Total effort: ${planning.metrics.totalEffortHours} hours`,
    `- Scheduled elapsed time: ${planning.metrics.scheduledHours} hours`,
    `- Critical path: ${planning.metrics.criticalPathHours} hours`,
    `- Parallelism saved: ${planning.metrics.parallelismSavingsHours} hours`,
    ""
  ];
  for (const wave of planning.waves) {
    lines.push(
      `### Wave ${wave.index} \xB7 hours ${wave.startHour}-${wave.endHour}`,
      "",
      ...wave.workItemIds.map((id) => {
        const item = planning.workItems.find(
          (candidate) => candidate.id === id
        );
        return `- **${item.title}** (${item.agentId}, ${item.agentRole}, ${item.estimatedHours}h)`;
      }),
      ""
    );
  }
  lines.push("## Work items", "");
  for (const item of planning.workItems) {
    lines.push(
      `### ${item.id}: ${item.title}`,
      "",
      item.description,
      "",
      `- Agent: ${item.agentId} (${item.agentRole})`,
      `- Estimate: ${item.estimatedHours} hours`,
      `- Dependencies: ${item.dependencies.join(", ") || "None"}`,
      `- Files: ${item.files.join(", ") || "To be discovered within owned scope"}`,
      `- Skills: ${item.skills.join(", ") || "General implementation"}`,
      "- Acceptance criteria:",
      ...item.acceptanceCriteria.map((criterion) => `  - ${criterion}`),
      "- Validation:",
      ...item.validation.map((step) => `  - ${step}`),
      ""
    );
  }
  lines.push(
    "## Agent workload",
    "",
    ...planning.agents.map(
      (agent) => `- **${agent.id}**: ${agent.estimatedHours}h across ${agent.workItemIds.join(", ")}; roles: ${agent.roles.join(", ")}`
    ),
    "",
    "## Risks",
    "",
    ...planning.risks.length > 0 ? planning.risks.map((risk) => `- ${risk}`) : ["- No additional planning risks recorded."]
  );
  return {
    id: "execution-plan",
    title: "Execution plan",
    kind: "execution-plan",
    stage: "plan",
    path: "",
    language: "markdown",
    content: lines.join("\n").trim(),
    mermaid: mermaid.join("\n"),
    sourceThreadIds: [],
    reviewStatus: "current"
  };
}
function implementationEvent(type, message) {
  return {
    id: randomUUID3(),
    type,
    message,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function executionInputRevision(state, kind) {
  const planning = normalizePlanning(state.planning);
  const artifactId = kind === "implementation" ? "execution-plan" : "test-spec";
  return executionDigest({
    generation: state.generation,
    input: kind === "implementation" ? { workItems: planning.workItems, maxAgents: planning.maxAgents, strategy: planning.strategy } : { scenarios: normalizeDesignReview(state.testDesignReview).scenarios },
    artifact: state.artifacts.find((artifact) => artifact.id === artifactId) || null
  });
}
function executionRuntime(state, kind) {
  return kind === "implementation" ? normalizeImplementation(state.implementation, normalizePlanning(state.planning)) : normalizeTesting(state.testing, normalizeDesignReview(state.testDesignReview));
}
function assertCurrentExecution(state, kind, token, allowUnbound = false, requireActive = true, allowCancellation = false) {
  const runtime = executionRuntime(state, kind);
  if (state.lifecycle.currentStage !== (kind === "implementation" ? "implement" : "test") || requireActive && !["starting", "running"].includes(runtime.status) || !allowCancellation && runtime.cancellation && !runtime.cancellation.confirmedAt) {
    throw new ExecutionSupersededError();
  }
  assertExecutionRequest(
    runtime,
    token,
    executionInputRevision(state, kind),
    WORKSPACE_ROOT,
    session.sessionId,
    allowUnbound
  );
  return runtime;
}
async function bindExecutionRun(prototypeId, kind, token) {
  if (!token.runId) throw new Error("The SDK did not supply a durable execution run ID.");
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const runtime = assertCurrentExecution(state, kind, token, true, false, true);
    if (runtime.runId === token.runId) return;
    if (!["starting", "running"].includes(runtime.status)) throw new ExecutionSupersededError();
    await persistState({
      ...state,
      [kind]: {
        ...runtime,
        runId: token.runId,
        status: "running",
        launchState: "bound",
        cancellation: runtime.cancellation && !runtime.cancellation.confirmedAt ? { ...runtime.cancellation, runId: token.runId } : runtime.cancellation
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    publishState(prototypeId);
  });
}
async function recordExecutionFailure(prototypeId, kind, expected, error) {
  if (error instanceof ExecutionSupersededError || error instanceof ExecutionCancellationPendingError) return;
  const message = error instanceof Error ? error.message : String(error);
  const request = await requestExecutionCancellation(prototypeId, kind, expected, message, "failed", error);
  await performExecutionCancellation(prototypeId, kind, request.token, request.cancellationId);
}
async function requestExecutionCancellation(prototypeId, kind, expected, reason, outcome, failure) {
  return withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const bound = executionToken(executionRuntime(state, kind));
    if (expected && (bound.requestId !== expected.requestId || bound.inputRevision !== expected.inputRevision || bound.ownerSessionId !== expected.ownerSessionId || bound.workspaceRoot !== expected.workspaceRoot || expected.runId && bound.runId !== expected.runId)) throw new ExecutionSupersededError();
    const token = expected ? { ...expected, runId: expected.runId || bound.runId } : bound;
    const runtime = assertCurrentExecution(state, kind, token, true, false, true);
    if (!["starting", "running"].includes(runtime.status) && !hasUnconfirmedExecution(runtime)) {
      throw new AnswerRequestError(409, "No unconfirmed execution is active.");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const cancellation = runtime.cancellation && !runtime.cancellation.confirmedAt ? runtime.cancellation : {
      requestId: randomUUID3(),
      runId: token.runId,
      requestedAt: now,
      confirmedAt: null,
      outcome,
      reason,
      error: ""
    };
    const nextRuntime = {
      ...runtime,
      status: "running",
      cancellation,
      error: reason,
      completedAt: null,
      finalizedArtifactId: null,
      ...failure && kind === "testing" ? {
        scenarios: executionRuntime(state, "testing").scenarios.map((item) => failure instanceof ExecutionSourceChangedError ? { ...item, status: "pending", summary: "", evidence: [], startedAt: null, completedAt: null } : item.status === "running" ? { ...item, status: "failed", summary: reason, completedAt: now } : item)
      } : failure ? {
        workItems: executionRuntime(state, "implementation").workItems.map((item) => item.status === "running" ? { ...item, status: "failed", blockers: [reason], completedAt: now } : item)
      } : {}
    };
    const failedRuntime = kind === "testing" ? {
      ...nextRuntime,
      errorDetails: testRunErrorDetails(
        testFailureEnvelope(token.runId, failure, reason),
        {},
        normalizeTesting(nextRuntime, normalizeDesignReview(state.testDesignReview)),
        reason
      )
    } : nextRuntime;
    await persistState({
      ...state,
      [kind]: failedRuntime,
      artifacts: kind === "testing" ? markTestResultsStale(state.artifacts) : markFinalCodeStale(state.artifacts),
      status: `Termination requested; awaiting SDK confirmation. ${reason}`,
      updatedAt: now
    });
    publishState(prototypeId);
    return { token, cancellationId: cancellation.requestId };
  });
}
function cancellationRuntime(state, kind, token, cancellationId) {
  const runtime = assertCurrentExecution(state, kind, token, !token.runId, false, true);
  if (runtime.cancellation?.requestId !== cancellationId || runtime.cancellation.runId !== token.runId) {
    throw new ExecutionSupersededError();
  }
  return runtime;
}
async function finishExecutionCancellation(prototypeId, kind, token, run, cancellationId) {
  return withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const current = assertCurrentExecution(state, kind, token, !token.runId, false, true);
    if (!current.cancellation) return false;
    const runtime = cancellationRuntime(state, kind, token, cancellationId || current.cancellation.requestId);
    if (runtime.cancellation.confirmedAt) return true;
    if (token.runId ? !run || run.runId !== token.runId || !isFactoryRunTerminal(run.status) : run !== null || runtime.launchState !== "unrequested") {
      throw new ExecutionCancellationPendingError("SDK termination has not been confirmed. Retry stopping the run.");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const status = kind === "implementation" ? runtime.cancellation.outcome : "failed";
    const stopped = runtime.cancellation.outcome === "cancelled";
    const message = stopped ? "Execution stopped after termination was confirmed." : runtime.cancellation.reason;
    const nextRuntime = {
      ...runtime,
      status,
      completedAt: now,
      terminalConfirmedAt: now,
      launchState: "settled",
      error: message,
      cancellation: { ...runtime.cancellation, confirmedAt: now, error: "" },
      agents: runtime.agents.map((agent) => agent.status === "running" ? { ...agent, status: kind === "implementation" && stopped ? "cancelled" : "failed", activity: message } : agent),
      ...kind === "implementation" ? {
        workItems: executionRuntime(state, "implementation").workItems.map((item) => item.status === "running" ? { ...item, status: stopped ? "cancelled" : "failed", blockers: [message], completedAt: now } : item)
      } : {
        scenarios: executionRuntime(state, "testing").scenarios.map((item) => item.status === "running" ? { ...item, status: "failed", summary: message, completedAt: now } : item)
      }
    };
    await persistState({ ...state, [kind]: nextRuntime, status: message, updatedAt: now });
    publishState(prototypeId);
    return true;
  });
}
async function performExecutionCancellation(prototypeId, kind, token, cancellationId) {
  const read = () => withAnswerClaim(prototypeId, async () => cancellationRuntime(await loadState(prototypeId), kind, token, cancellationId));
  try {
    const runtime = await read();
    if (runtime.cancellation.confirmedAt) return;
    if (!token.runId) {
      if (runtime.launchState !== "unrequested") {
        throw new Error("The SDK run ID is unavailable; termination cannot yet be confirmed. Retry stopping after its identity is recovered.");
      }
      await finishExecutionCancellation(prototypeId, kind, token, null, cancellationId);
      return;
    }
    let run = await session.factory.getRun(token.runId);
    if (run.runId !== token.runId) throw new ExecutionSupersededError();
    if (!isFactoryRunTerminal(run.status)) {
      await read();
      run = await session.factory.cancel(token.runId);
    }
    await finishExecutionCancellation(prototypeId, kind, token, run, cancellationId);
  } catch (error) {
    if (error instanceof ExecutionSupersededError) throw error;
    const message = `Termination is unconfirmed: ${error instanceof Error ? error.message : String(error)}`;
    const confirmed = await withAnswerClaim(prototypeId, async () => {
      const state = await loadState(prototypeId);
      const runtime = cancellationRuntime(state, kind, token, cancellationId);
      if (runtime.cancellation.confirmedAt) return true;
      await persistState({ ...state, [kind]: {
        ...runtime,
        status: "running",
        completedAt: null,
        error: message,
        cancellation: { ...runtime.cancellation, error: message }
      }, status: `${message} Retry Stop; reset and reopening remain blocked.`, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      publishState(prototypeId);
      return false;
    });
    if (!confirmed) throw new ExecutionCancellationPendingError(message);
  }
}
async function assertPreviousExecutionStopped(runtime) {
  if (hasUnconfirmedExecution(runtime)) throw new AnswerRequestError(
    409,
    "The previous SDK run has no confirmed termination. Stop or recover it before retrying."
  );
}
async function assertExecutionDispatch(prototypeId, kind, token) {
  await withAnswerClaim(prototypeId, async () => {
    assertCurrentExecution(await loadState(prototypeId), kind, token);
    if (kind === "testing") await assertExecutionSources(token);
  });
}
async function assertCurrentTestEvidence(state) {
  const testing = executionRuntime(state, "testing");
  if (testing.status !== "completed" || testing.finalizedArtifactId !== "test-results" || !testing.runId || testing.scenarios.length === 0 || testing.scenarios.some((scenario) => scenario.status !== "passed" || !scenario.summary || scenario.evidence.length === 0) || !state.artifacts.some((artifact) => artifact.id === "test-results" && artifact.reviewStatus === "current") || testing.inputRevision !== executionInputRevision(state, "testing") || testing.workspaceRoot !== executionWorkspace(WORKSPACE_ROOT)) {
    throw new Error("Test evidence does not match the current specification and workspace.");
  }
  await assertExecutionSources(executionToken(testing));
}
function implementationPrompt(args, item, strategy, completedHandoffs) {
  return [
    `Implement work item "${item.id}: ${item.title}" in the active workspace.`,
    "",
    `Project root: ${args.projectRoot}`,
    `Assigned role: ${item.agentRole}`,
    `Description: ${item.description}`,
    `Owned files or paths: ${item.files.join(", ") || "Discover the smallest necessary scope."}`,
    `Dependencies: ${item.dependencies.join(", ") || "None"}`,
    "",
    "Acceptance criteria:",
    ...item.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Validation:",
    ...item.validation.map((step) => `- ${step}`),
    "",
    strategy.length > 0 ? `Execution strategy updates:
${strategy.map((entry) => `- ${entry}`).join("\n")}` : "Execution strategy updates: none.",
    completedHandoffs.length > 0 ? `Completed dependency handoffs:
${completedHandoffs.map((entry) => `- ${entry}`).join("\n")}` : "Completed dependency handoffs: none.",
    "",
    "Work directly in the active workspace and fully implement this item. Respect the",
    "owned file scope and avoid editing files assigned to concurrent work items unless",
    "the change is strictly required; report any unavoidable overlap. Preserve existing",
    "user changes. Do not create branches, commits, stashes, or pull requests. Run the",
    "smallest existing validation that proves the acceptance criteria. Return a concise",
    "structured result with every changed workspace-relative file and validation outcome. For EACH listed",
    "validation requirement return { requirement, status, evidence }; copy the exact",
    "requirement text, use passed/failed/skipped, and include concrete observed evidence.",
    "Return completed only with a nonempty summary, all validations passed, and no blockers."
  ].join("\n");
}
async function prepareImplementationWave(prototypeId, waveIndex, workItemIds, token) {
  await bindExecutionRun(prototypeId, "implementation", token);
  return withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    const implementation = assertCurrentExecution(state, "implementation", token);
    const scheduled = planning.waves.find((wave) => wave.index === waveIndex);
    if (!scheduled || executionDigest(scheduled.workItemIds) !== executionDigest(workItemIds)) {
      throw new Error("The implementation wave does not match its accepted plan.");
    }
    const saved = implementation.waveManifests.find((wave) => wave.index === waveIndex);
    if (saved) {
      return {
        runnable: saved.itemIds.filter((id) => implementation.workItems.find((item) => item.id === id)?.status !== "completed").map((id) => planning.workItems.find((item) => item.id === id)),
        strategy: saved.strategy,
        completedHandoffs: saved.handoffs,
        maxConcurrency: saved.maxConcurrency,
        stopped: false
      };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const queued = implementation.strategySuggestions.filter(
      (suggestion) => suggestion.status === "queued"
    );
    const strategy = implementation.strategySuggestions.map(
      (suggestion) => suggestion.text
    );
    let maxConcurrency = planning.maxAgents;
    for (const text of strategy) {
      if (/\b(serial|one at a time|single agent)\b/i.test(text)) {
        maxConcurrency = 1;
        continue;
      }
      const match = text.match(
        /\b(?:max(?:imum)?|limit|use|reduce(?:\s+parallelism)?\s+to)\s*(?:to\s*)?(\d{1,2})\s*(?:agents?)?\b/i
      );
      if (match) {
        maxConcurrency = Math.max(
          1,
          Math.min(planning.maxAgents, Number(match[1]))
        );
      }
    }
    const workById = new Map(
      implementation.workItems.map((item) => [item.id, item])
    );
    const runnable = [];
    for (const id of workItemIds) {
      const planItem = planning.workItems.find((item) => item.id === id);
      const runtime = workById.get(id);
      if (!planItem || !runtime || runtime.status === "completed") continue;
      const dependencyStates = planItem.dependencies.map(
        (dependency) => workById.get(dependency)?.status || "pending"
      );
      if (dependencyStates.some(
        (status) => ["failed", "blocked", "cancelled"].includes(status)
      )) {
        runtime.status = "blocked";
        runtime.blockers = [
          "A prerequisite work item did not complete successfully."
        ];
        runtime.completedAt = now;
        continue;
      }
      if (dependencyStates.some((status) => status !== "completed")) {
        runtime.status = "pending";
        continue;
      }
      runtime.status = "running";
      runtime.startedAt = now;
      runtime.completedAt = null;
      runtime.summary = "";
      runtime.blockers = [];
      runnable.push(planItem);
    }
    runnable.sort((left, right) => {
      const priorityScore = (item) => strategy.filter(
        (text) => /\b(prioritize|first|earlier|urgent)\b/i.test(text) && (text.toLowerCase().includes(item.id.toLowerCase()) || text.toLowerCase().includes(item.title.toLowerCase()))
      ).length;
      return priorityScore(right) - priorityScore(left);
    });
    const completedHandoffs = implementation.workItems.filter((item) => item.status === "completed" && runnable.some((candidate) => candidate.dependencies.includes(item.id))).map((item) => `${item.id}: ${item.summary || "completed"}`);
    const manifest = {
      index: waveIndex,
      itemIds: runnable.map((item) => item.id),
      strategy,
      handoffs: completedHandoffs,
      maxConcurrency
    };
    const runnableIds = new Set(runnable.map((item) => item.id));
    const agents = implementation.agents.filter(
      (agent) => !runnableIds.has(agent.workItemId)
    );
    for (const item of runnable) {
      agents.push({
        id: `work:${item.id}`,
        workItemId: item.id,
        role: item.agentRole,
        status: "running",
        activity: `Implementing ${item.title}`,
        activeMs: 0,
        model: "",
        summary: ""
      });
    }
    const events = [...implementation.events];
    if (queued.length > 0) {
      events.push(
        implementationEvent(
          "strategy",
          `${queued.length} strategy suggestion${queued.length === 1 ? "" : "s"} applied to wave ${waveIndex}.`
        )
      );
    }
    if (runnable.length > 0) {
      events.push(
        implementationEvent(
          "wave",
          `Wave ${waveIndex} started with ${runnable.length} work item${runnable.length === 1 ? "" : "s"}.`
        )
      );
    }
    const nextImplementation = normalizeImplementation(
      {
        ...implementation,
        status: "running",
        currentWaveIndex: waveIndex,
        waveManifests: [...implementation.waveManifests, manifest],
        workItems: [...workById.values()],
        agents,
        strategySuggestions: implementation.strategySuggestions.map(
          (suggestion) => suggestion.status === "queued" ? {
            ...suggestion,
            status: "applied",
            appliedAt: now,
            waveIndex
          } : suggestion
        ),
        events,
        error: ""
      },
      planning
    );
    const next = {
      ...state,
      implementation: nextImplementation,
      status: runnable.length > 0 ? `Implementation wave ${waveIndex} is running.` : state.status,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
    return {
      runnable,
      strategy,
      completedHandoffs,
      maxConcurrency,
      stopped: false
    };
  });
}
async function recordImplementationWaveResults(prototypeId, waveIndex, entries, token) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    const implementation = assertCurrentExecution(state, "implementation", token);
    const manifest = implementation.waveManifests.find((wave) => wave.index === waveIndex);
    if (!manifest || entries.some((entry) => !manifest.itemIds.includes(entry.itemId))) {
      throw new Error("Implementation results do not belong to the dispatched wave.");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const workById = new Map(
      implementation.workItems.map((item) => [item.id, item])
    );
    const agentByItem = new Map(
      implementation.agents.map((agent) => [agent.workItemId, agent])
    );
    let failedCount = 0;
    for (const entry of entries) {
      const item = planning.workItems.find((item2) => item2.id === entry.itemId);
      const result = workerOutcome(entry.result, item.validation);
      const outside = result.filesChanged.filter((path) => !ownershipContains(item.files, path));
      if (outside.length) {
        result.status = "failed";
        result.blockers.push(`Changed paths outside this item's ownership: ${outside.join(", ")}`);
        result.summary = `${result.summary} ${result.blockers.join(" ")}`;
      }
      const succeeded = result?.status === "completed";
      const runtime = workById.get(item.id);
      if (!runtime) continue;
      if (runtime.status === "completed") continue;
      runtime.status = succeeded ? "completed" : "failed";
      runtime.summary = String(
        result?.summary || (succeeded ? "Work item completed." : "The implementation agent returned no successful result.")
      ).trim().slice(0, 12e3);
      runtime.filesChanged = normalizeStringList(result?.filesChanged);
      runtime.validation = normalizeStringList(result?.validation);
      runtime.blockers = normalizeStringList(
        result?.blockers || (succeeded ? [] : ["Implementation agent failed."])
      );
      runtime.completedAt = now;
      if (!succeeded) failedCount += 1;
      const agent = agentByItem.get(item.id);
      if (agent) {
        agent.status = succeeded ? "completed" : "failed";
        agent.activity = succeeded ? "Work item complete" : "Work item failed";
        agent.summary = runtime.summary;
      }
    }
    const events = [
      ...implementation.events,
      implementationEvent(
        failedCount > 0 ? "error" : "wave",
        `Wave ${waveIndex} recorded: ${entries.length - failedCount} completed, ${failedCount} failed.`
      )
    ];
    const next = {
      ...state,
      implementation: normalizeImplementation(
        {
          ...implementation,
          workItems: [...workById.values()],
          agents: [...agentByItem.values()],
          events
        },
        planning
      ),
      status: failedCount > 0 ? `Wave ${waveIndex} completed with failures.` : `Wave ${waveIndex} completed.`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
function finalCodeArtifact(state) {
  const implementation = normalizeImplementation(
    state.implementation,
    normalizePlanning(state.planning)
  );
  const changedFiles = [
    ...new Set(
      implementation.workItems.flatMap((item) => item.filesChanged)
    )
  ];
  const lines = [
    "# Final code",
    "",
    `Implementation completed ${implementation.completedAt || "successfully"}.`,
    `Plan revision: ${implementation.inputRevision || "unavailable"}.`,
    `Execution request: ${implementation.requestId || "unavailable"}; SDK run: ${implementation.runId || "unavailable"}.`,
    "",
    "## Work items",
    "",
    ...implementation.workItems.map(
      (item) => `- **${item.id}**: ${item.summary || "Completed"}`
    ),
    "",
    "## Changed files",
    "",
    ...changedFiles.length > 0 ? changedFiles.map((path) => `- \`${path}\``) : ["- Changes are contained in the active workspace."],
    "",
    "## Validation",
    "",
    ...implementation.workItems.flatMap(
      (item) => item.validation.map((entry) => `- ${item.id}: ${entry}`)
    )
  ];
  return {
    id: "final-code",
    title: "Final code",
    kind: "final-code",
    stage: "implement",
    path: ".",
    language: "markdown",
    content: lines.join("\n").trim(),
    mermaid: "",
    sourceThreadIds: [],
    reviewStatus: "current"
  };
}
async function settleImplementationRun(prototypeId, run, token) {
  if (!token?.runId || run.runId !== token.runId) throw new ExecutionSupersededError();
  if (!isFactoryRunTerminal(run.status)) throw new Error("Implementation termination is not confirmed.");
  if (await finishExecutionCancellation(prototypeId, "implementation", token, run)) return;
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const planning = normalizePlanning(state.planning);
    const implementation = assertCurrentExecution(state, "implementation", token);
    const result = isObject(run.result) ? run.result : {};
    const allCompleted = implementation.workItems.length > 0 && implementation.workItems.every(
      (item) => item.status === "completed" && item.summary && item.validation.length > 0 && item.blockers.length === 0
    );
    const succeeded = run.status === "completed" && result.status === "completed" && allCompleted;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let artifacts = state.artifacts;
    let finalizedArtifactId = null;
    if (succeeded) {
      const completedImplementation = {
        ...implementation,
        status: "completed",
        completedAt: now
      };
      const artifact = finalCodeArtifact({
        ...state,
        implementation: completedImplementation
      });
      artifacts = normalizeArtifacts([
        artifact,
        ...state.artifacts.filter(
          (candidate) => candidate.id !== artifact.id
        )
      ]);
      finalizedArtifactId = artifact.id;
    } else {
      artifacts = markFinalCodeStale(state.artifacts);
    }
    const status = run.status === "cancelled" ? "cancelled" : succeeded ? "completed" : "failed";
    const error = succeeded ? "" : String(
      result.summary || (run.status === "completed" ? "One or more implementation work items did not complete." : factoryErrorMessage(run))
    ).slice(0, 2e3);
    const next = {
      ...state,
      artifacts,
      implementation: normalizeImplementation(
        {
          ...implementation,
          status,
          terminalConfirmedAt: now,
          launchState: "settled",
          workItems: implementation.workItems.map((item) => item.status === "running" ? {
            ...item,
            status: status === "cancelled" ? "cancelled" : "failed",
            blockers: [error],
            completedAt: now
          } : item),
          agents: implementation.agents.map((agent) => agent.status === "running" ? { ...agent, status: status === "cancelled" ? "cancelled" : "failed", activity: error } : agent),
          completedAt: now,
          finalizedArtifactId,
          error,
          events: [
            ...implementation.events,
            implementationEvent(
              succeeded ? "complete" : "error",
              succeeded ? "Implementation completed and final code was captured." : status === "cancelled" ? "Implementation was stopped." : `Implementation stopped: ${error}`
            )
          ]
        },
        planning
      ),
      status: succeeded ? "Implementation complete. Final code is ready." : status === "cancelled" ? "Implementation stopped." : `Implementation needs attention: ${error}`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function runImplementationFactory(prototypeId, state, resumeFromRunId = null) {
  return runExecutionFactory(prototypeId, state, "implementation", resumeFromRunId);
}
async function resumeExecutionRun(prototypeId, kind, token) {
  const check = () => withAnswerClaim(prototypeId, async () => assertCurrentExecution(await loadState(prototypeId), kind, token));
  await check();
  try {
    return await session.factory.resume(token.runId);
  } catch (error) {
    if (!["already_active", "factory_already_running"].includes(factoryErrorCode(error))) throw error;
    await check();
    const existing = await session.factory.getRun(token.runId);
    if (existing.runId !== token.runId) throw new ExecutionSupersededError();
    if (existing.status === "halted") throw error;
    if (isFactoryRunTerminal(existing.status)) return existing;
    await check();
    return session.factory.waitForRun(token.runId);
  }
}
async function runExecutionFactory(prototypeId, state, kind, resumeFromRunId = null) {
  let token = executionToken(state[kind]);
  if (!resumeFromRunId && token.runId) throw new Error("An existing execution run must be recovered or resumed, not started again.");
  await withAnswerClaim(prototypeId, async () => {
    const current = await loadState(prototypeId);
    const runtime = assertCurrentExecution(current, kind, token, !resumeFromRunId);
    if (resumeFromRunId && token.runId !== resumeFromRunId) throw new ExecutionSupersededError();
    if (kind === "testing") await assertExecutionSources(token);
    if (!resumeFromRunId) {
      await persistState({
        ...current,
        [kind]: { ...runtime, launchState: "requested" },
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  });
  const run = resumeFromRunId ? await resumeExecutionRun(prototypeId, kind, token) : await session.rpc.factory.run({
    name: kind === "implementation" ? IMPLEMENTATION_FACTORY_NAME : TEST_FACTORY_NAME,
    args: {
      prototypeId,
      projectRoot: WORKSPACE_ROOT,
      execution: token,
      ...kind === "implementation" ? { plan: normalizePlanning(state.planning) } : { scenarios: normalizeDesignReview(state.testDesignReview).scenarios }
    },
    options: { limits: { maxConcurrentSubagents: kind === "implementation" ? state.planning.maxAgents : 4 } }
  });
  token = { ...token, runId: run.runId };
  try {
    await bindExecutionRun(prototypeId, kind, token);
  } catch (error) {
    if (!isFactoryRunTerminal(run.status) && token.runId === run.runId && token.ownerSessionId === session.sessionId && token.workspaceRoot === executionWorkspace(WORKSPACE_ROOT)) {
      await session.factory.cancel(token.runId);
    }
    throw error;
  }
  const pendingCancellation = await withAnswerClaim(prototypeId, async () => {
    const runtime = assertCurrentExecution(await loadState(prototypeId), kind, token, false, false, true);
    return runtime.cancellation && !runtime.cancellation.confirmedAt ? runtime.cancellation.requestId : null;
  });
  if (pendingCancellation) {
    if (isFactoryRunTerminal(run.status)) await finishExecutionCancellation(prototypeId, kind, token, run, pendingCancellation);
    else await performExecutionCancellation(prototypeId, kind, token, pendingCancellation);
    return;
  }
  await withAnswerClaim(prototypeId, async () => assertCurrentExecution(await loadState(prototypeId), kind, token));
  const terminal = isFactoryRunTerminal(run.status) ? run : await session.factory.waitForRun(run.runId);
  if (terminal.status === "halted") return;
  if (kind === "implementation") await settleImplementationRun(prototypeId, terminal, token);
  else await settleTestRun(prototypeId, terminal, token);
}
function trackExecution(prototypeId, state, kind, operation) {
  const active = kind === "implementation" ? activeImplementationRuns : activeTestRuns;
  if (active.has(prototypeId)) return;
  const token = executionToken(state[kind]);
  const work = operation().catch((error) => recordExecutionFailure(prototypeId, kind, token, error)).catch((error) => {
    if (!(error instanceof ExecutionSupersededError)) {
      return logSafely(`Tandem could not record execution failure: ${error instanceof Error ? error.message : String(error)}`);
    }
  }).finally(() => {
    if (active.get(prototypeId) === work) active.delete(prototypeId);
  });
  active.set(prototypeId, work);
}
function startImplementationFactory(prototypeId, state, resumeFromRunId = null) {
  trackExecution(
    prototypeId,
    state,
    "implementation",
    () => runImplementationFactory(prototypeId, state, resumeFromRunId)
  );
}
function hasExecutionIdentity(runtime) {
  return Boolean(runtime.requestId && runtime.inputRevision && runtime.ownerSessionId && runtime.workspaceRoot);
}
async function failLegacyExecutions(observed) {
  await withAnswerClaim(observed.prototypeId, async () => {
    const current = await loadState(observed.prototypeId);
    if (current.generation !== observed.generation || current.jobOwner && !sameOwner(current.jobOwner, { sessionId: session.sessionId, workspaceRoot: WORKSPACE_ROOT })) return;
    const next = { ...current };
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let changed = false;
    for (const kind of ["implementation", "testing"]) {
      const runtime = executionRuntime(current, kind);
      if (!["starting", "running"].includes(runtime.status) || hasExecutionIdentity(runtime) || executionDigest(runtime) !== executionDigest(executionRuntime(observed, kind)) || runtime.ownerSessionId && runtime.ownerSessionId !== session.sessionId || runtime.workspaceRoot && runtime.workspaceRoot !== executionWorkspace(WORKSPACE_ROOT)) continue;
      const message = `Legacy ${kind} execution has no durable request/owner identity. Automatic recovery was stopped. ${runtime.runId ? `Inspect SDK run ${runtime.runId} and confirm it has stopped before retrying.` : "Confirm previous agents have stopped, then explicitly retry to create a new request."}`;
      next[kind] = {
        ...runtime,
        status: "failed",
        error: message,
        completedAt: now,
        finalizedArtifactId: null,
        agents: runtime.agents.map((agent) => ({ ...agent, status: "failed", activity: message })),
        ...kind === "implementation" ? {
          workItems: executionRuntime(current, "implementation").workItems.map((item) => item.status === "running" ? { ...item, status: "failed", blockers: [message], completedAt: now } : item)
        } : {
          scenarios: executionRuntime(current, "testing").scenarios.map((item) => item.status === "running" ? { ...item, status: "failed", summary: message, completedAt: now } : item)
        }
      };
      if (kind === "testing") {
        next.testing.errorDetails = testRunErrorDetails(
          testFailureEnvelope(runtime.runId, null, message),
          {},
          normalizeTesting(next.testing, normalizeDesignReview(current.testDesignReview)),
          message
        );
      }
      next.artifacts = kind === "implementation" ? markFinalCodeStale(next.artifacts) : markTestResultsStale(next.artifacts);
      next.status = message;
      changed = true;
    }
    if (!changed) return;
    if (!current.jobOwner && hasActiveWork(next)) {
      throw new Error("Other ownerless legacy jobs also require recovery; execution migration will not claim their ownership.");
    }
    next.updatedAt = now;
    await persistState(next);
    publishState(current.prototypeId);
  });
}
function recoverExecutionFactory(state, canSubmitAnswers, kind) {
  const runtime = executionRuntime(state, kind);
  const active = kind === "implementation" ? activeImplementationRuns : activeTestRuns;
  if (!canSubmitAnswers || state.lifecycle.currentStage !== (kind === "implementation" ? "implement" : "test") || !["starting", "running"].includes(runtime.status) && !hasUnconfirmedExecution(runtime) || active.has(state.prototypeId)) return;
  if (!hasExecutionIdentity(runtime)) {
    const work = (hasUnconfirmedExecution(runtime) ? logSafely(`Unconfirmed legacy ${kind} termination retains SDK run ${runtime.runId || "(unknown)"}. Return to the originating session and confirm termination; reset and reopening remain blocked.`) : failLegacyExecutions(state)).catch((error) => logSafely(`Legacy execution recovery needs attention: ${error instanceof Error ? error.message : String(error)}`)).finally(() => {
      if (active.get(state.prototypeId) === work) active.delete(state.prototypeId);
    });
    active.set(state.prototypeId, work);
    return;
  }
  const token = executionToken(runtime);
  if (token.ownerSessionId !== session.sessionId || token.workspaceRoot !== executionWorkspace(WORKSPACE_ROOT)) return;
  trackExecution(state.prototypeId, state, kind, async () => {
    if (hasUnconfirmedExecution(runtime)) {
      const request = await requestExecutionCancellation(
        state.prototypeId,
        kind,
        token,
        runtime.cancellation?.reason || "Confirm termination of the interrupted execution.",
        runtime.status === "cancelled" ? "cancelled" : "failed"
      );
      await performExecutionCancellation(state.prototypeId, kind, request.token, request.cancellationId);
      return;
    }
    await withAnswerClaim(state.prototypeId, async () => {
      assertCurrentExecution(await loadState(state.prototypeId), kind, token, !token.runId);
      if (kind === "testing") await assertExecutionSources(token);
    });
    if (!token.runId) {
      throw new Error("The previous execution has no durable SDK run ID. Inspect its status before explicitly retrying; automatic restart is unsafe.");
    }
    let run = await session.factory.getRun(token.runId);
    if (run.runId !== token.runId) throw new ExecutionSupersededError();
    if (run.status === "halted") {
      await runExecutionFactory(state.prototypeId, state, kind, token.runId);
      return;
    }
    if (!isFactoryRunTerminal(run.status)) {
      await withAnswerClaim(state.prototypeId, async () => assertCurrentExecution(await loadState(state.prototypeId), kind, token));
      run = await session.factory.waitForRun(token.runId);
    }
    if (kind === "implementation") await settleImplementationRun(state.prototypeId, run, token);
    else await settleTestRun(state.prototypeId, run, token);
  });
}
function recoverImplementationFactory(state, canSubmitAnswers) {
  recoverExecutionFactory(state, canSubmitAnswers, "implementation");
}
function testEvent(type, message) {
  return {
    id: randomUUID3(),
    type,
    message,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function markTestResultsStale(artifacts) {
  return artifacts.map(
    (artifact) => artifact.stage === "test" && artifact.id === "test-results" ? { ...artifact, reviewStatus: "stale" } : artifact
  );
}
function testScenarioPrompt(args, scenario, dependencyEvidence) {
  return [
    `Execute ${scenario.type} test scenario "${scenario.id}: ${scenario.title}".`,
    "",
    `Project root: ${args.projectRoot}`,
    `Description: ${scenario.description}`,
    `Expected outcome: ${scenario.expectedOutcome}`,
    "",
    "Steps:",
    ...scenario.steps.map((step) => `- ${step}`),
    "",
    "Validation guidance:",
    ...scenario.validation.map((step) => `- ${step}`),
    "",
    dependencyEvidence.length > 0 ? `Dependency evidence:
${dependencyEvidence.map((entry) => `- ${entry}`).join("\n")}` : "Dependency evidence: none.",
    "",
    "Exercise the implemented application and its real integration boundaries using",
    "the existing repository tooling. Add or update integration/interaction test code",
    "only when the test specification requires it. Preserve user changes. Do not create",
    "branches, commits, stashes, or pull requests. Return passed only when the expected",
    "outcome is observed; otherwise return failed with concrete evidence. Include a",
    "nonempty summary and outcome evidence. For EACH validation requirement return",
    "{ requirement, status, evidence }, copying the exact requirement text and using",
    "passed/failed/skipped with concrete observed evidence. Source changes invalidate",
    "this test run and require a fresh retry against the updated workspace."
  ].join("\n");
}
async function prepareTestWave(prototypeId, wave, token) {
  await bindExecutionRun(prototypeId, "testing", token);
  return withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const review = normalizeDesignReview(state.testDesignReview);
    const testing = assertCurrentExecution(state, "testing", token);
    await assertExecutionSources(token);
    const scheduled = scheduleTestScenarios(review.scenarios, 4).waves.find((entry) => entry.index === wave.index);
    if (!scheduled || executionDigest(scheduled.scenarioIds) !== executionDigest(wave.scenarioIds)) {
      throw new Error("The test wave does not match its accepted specification.");
    }
    const saved = testing.waveManifests.find((entry) => entry.index === wave.index);
    if (saved) {
      return {
        runnable: saved.itemIds.filter((id) => testing.scenarios.find((item) => item.id === id)?.status !== "passed").map((id) => review.scenarios.find((item) => item.id === id)),
        dependencyEvidence: saved.handoffs
      };
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const runtimeById = new Map(
      testing.scenarios.map((scenario) => [scenario.id, scenario])
    );
    const runnable = [];
    for (const id of wave.scenarioIds) {
      const spec = review.scenarios.find((scenario) => scenario.id === id);
      const runtime = runtimeById.get(id);
      if (!spec || !runtime || runtime.status === "passed") continue;
      const dependencyStates = spec.dependencies.map(
        (dependency) => runtimeById.get(dependency)?.status || "pending"
      );
      if (dependencyStates.some((status) => status !== "passed")) {
        runtime.status = dependencyStates.some(
          (status) => ["failed", "blocked"].includes(status)
        ) ? "blocked" : "pending";
        continue;
      }
      runtime.status = "running";
      runtime.startedAt = now;
      runtime.completedAt = null;
      runtime.summary = "";
      runtime.evidence = [];
      runnable.push(spec);
    }
    const runnableIds = new Set(runnable.map((scenario) => scenario.id));
    const agents = testing.agents.filter(
      (agent) => !runnableIds.has(agent.scenarioId)
    );
    for (const scenario of runnable) {
      agents.push({
        id: `test:${scenario.id}`,
        scenarioId: scenario.id,
        status: "running",
        activity: `Running ${scenario.title}`,
        summary: ""
      });
    }
    const dependencyEvidence = testing.scenarios.filter((scenario) => scenario.status === "passed" && runnable.some((candidate) => candidate.dependencies.includes(scenario.id))).flatMap((scenario) => [`${scenario.id}: ${scenario.summary}`, ...scenario.evidence]);
    const manifest = {
      index: wave.index,
      itemIds: runnable.map((scenario) => scenario.id),
      handoffs: dependencyEvidence,
      strategy: [],
      maxConcurrency: 4
    };
    const next = {
      ...state,
      testing: normalizeTesting(
        {
          ...testing,
          status: "running",
          currentWaveIndex: wave.index,
          waveManifests: [...testing.waveManifests, manifest],
          scenarios: [...runtimeById.values()],
          agents,
          events: [
            ...testing.events,
            testEvent(
              "wave",
              `Test wave ${wave.index} started with ${runnable.length} scenario${runnable.length === 1 ? "" : "s"}.`
            )
          ]
        },
        review
      ),
      status: `Test wave ${wave.index} is running.`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
    return { runnable, dependencyEvidence };
  });
}
async function recordTestWaveResults(prototypeId, wave, entries, token) {
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const review = normalizeDesignReview(state.testDesignReview);
    const testing = assertCurrentExecution(state, "testing", token);
    await assertExecutionSources(token);
    const manifest = testing.waveManifests.find((entry) => entry.index === wave.index);
    if (!manifest || entries.some((entry) => !manifest.itemIds.includes(entry.itemId))) {
      throw new Error("Test results do not belong to the dispatched wave.");
    }
    const runtimeById = new Map(
      testing.scenarios.map((scenario) => [scenario.id, scenario])
    );
    const agentsById = new Map(
      testing.agents.map((agent) => [agent.scenarioId, agent])
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let failed = 0;
    for (const entry of entries) {
      const spec = review.scenarios.find((item) => item.id === entry.itemId);
      const result = workerOutcome(entry.result, spec.validation, true);
      const passed = result?.status === "passed";
      const runtime = runtimeById.get(spec.id);
      if (!runtime) continue;
      if (runtime.status === "passed") continue;
      runtime.status = passed ? "passed" : "failed";
      runtime.summary = String(
        result?.summary || (passed ? "Scenario passed." : "The test agent returned no passing result.")
      ).trim().slice(0, 12e3);
      runtime.evidence = normalizeStringList(
        result?.evidence || (passed ? [] : ["No passing evidence was returned."])
      );
      runtime.completedAt = now;
      if (!passed) failed += 1;
      const agent = agentsById.get(spec.id);
      if (agent) {
        agent.status = passed ? "passed" : "failed";
        agent.activity = passed ? "Scenario passed" : "Scenario failed";
        agent.summary = runtime.summary;
      }
    }
    const next = {
      ...state,
      testing: normalizeTesting(
        {
          ...testing,
          scenarios: [...runtimeById.values()],
          agents: [...agentsById.values()],
          events: [
            ...testing.events,
            testEvent(
              failed > 0 ? "error" : "wave",
              `Test wave ${wave.index} recorded: ${entries.length - failed} passed, ${failed} failed.`
            )
          ]
        },
        review
      ),
      status: failed > 0 ? `Test wave ${wave.index} completed with failures.` : `Test wave ${wave.index} passed.`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
function testResultsArtifact(state) {
  const review = normalizeDesignReview(state.testDesignReview);
  const testing = normalizeTesting(state.testing, review);
  return {
    id: "test-results",
    title: "Integration and interaction test results",
    kind: "test-results",
    stage: "test",
    path: ".",
    language: "markdown",
    content: [
      "# Integration and interaction test results",
      "",
      `Completed ${testing.completedAt || "successfully"}.`,
      `Source fingerprint: ${testing.sourceFingerprint || "unavailable"}.`,
      `Specification revision: ${testing.inputRevision || "unavailable"}.`,
      `Execution request: ${testing.requestId || "unavailable"}; SDK run: ${testing.runId || "unavailable"}.`,
      "",
      ...testing.scenarios.flatMap((runtime) => {
        const spec = review.scenarios.find(
          (scenario) => scenario.id === runtime.id
        );
        return [
          `## ${spec?.title || runtime.id}`,
          "",
          `- Type: ${spec?.type || "test"}`,
          `- Status: ${runtime.status}`,
          `- Summary: ${runtime.summary || "Passed"}`,
          ...runtime.evidence.map((entry) => `- Evidence: ${entry}`),
          ""
        ];
      })
    ].join("\n").trim(),
    mermaid: "",
    sourceThreadIds: [],
    reviewStatus: "current"
  };
}
function testFailureEnvelope(runId, error, summary) {
  const source = isObject(error) ? error : {};
  const cause = isObject(source.cause) ? source.cause.stack || source.cause.message : source.cause;
  return {
    runId,
    status: "error",
    error: typeof source.stack === "string" ? source.stack : summary,
    failure: source.data || (source.code !== void 0 ? { code: source.code } : null),
    reason: cause || null
  };
}
function testRunErrorDetails(run, result, testing, summary) {
  const failedScenarios = testing.scenarios.filter((scenario) => ["failed", "blocked"].includes(scenario.status)).map((scenario) => ({
    id: scenario.id,
    status: scenario.status,
    summary: scenario.summary,
    evidence: scenario.evidence
  }));
  const failedAgents = testing.agents.filter((agent) => ["failed", "blocked"].includes(agent.status)).map((agent) => ({
    id: agent.id,
    scenarioId: agent.scenarioId,
    status: agent.status,
    activity: agent.activity,
    summary: agent.summary
  }));
  const errorEvents = testing.events.filter((event) => event.type === "error").slice(-20);
  return JSON.stringify(
    {
      summary,
      run: {
        id: String(run.runId || testing.runId || "unavailable"),
        status: String(run.status || "unknown"),
        error: run.error || null,
        failure: run.failure || null,
        reason: run.reason || null,
        resultSummary: result.summary || null
      },
      failedScenarios,
      failedAgents,
      errorEvents
    },
    null,
    2
  ).slice(0, 5e4);
}
async function settleTestRun(prototypeId, run, token) {
  if (!token?.runId || run.runId !== token.runId) throw new ExecutionSupersededError();
  if (!isFactoryRunTerminal(run.status)) throw new Error("Test termination is not confirmed.");
  if (await finishExecutionCancellation(prototypeId, "testing", token, run)) return;
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const review = normalizeDesignReview(state.testDesignReview);
    const testing = assertCurrentExecution(state, "testing", token);
    await assertExecutionSources(token);
    const result = isObject(run.result) ? run.result : {};
    const passed = run.status === "completed" && result.status === "passed" && testing.scenarios.length > 0 && testing.scenarios.every((scenario) => scenario.status === "passed" && scenario.summary && scenario.evidence.length > 0);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let artifacts = markTestResultsStale(state.artifacts);
    let finalizedArtifactId = null;
    if (passed) {
      const completedTesting = {
        ...testing,
        status: "completed",
        completedAt: now
      };
      const artifact = testResultsArtifact({
        ...state,
        testing: completedTesting
      });
      artifacts = normalizeArtifacts([
        artifact,
        ...state.artifacts.filter(
          (candidate) => candidate.id !== artifact.id
        )
      ]);
      finalizedArtifactId = artifact.id;
    }
    const error = passed ? "" : String(
      result.summary || (run.status === "completed" ? "One or more test scenarios failed." : factoryErrorMessage(run))
    ).slice(0, 2e3);
    const settledScenarios = testing.scenarios.map((scenario) => scenario.status === "running" ? { ...scenario, status: "failed", summary: error, completedAt: now } : scenario);
    const settledAgents = testing.agents.map((agent) => agent.status === "running" ? { ...agent, status: "failed", activity: error } : agent);
    const errorDetails = passed ? "" : testRunErrorDetails(run, result, { ...testing, scenarios: settledScenarios, agents: settledAgents }, error);
    const next = {
      ...state,
      artifacts,
      testing: normalizeTesting(
        {
          ...testing,
          status: passed ? "completed" : "failed",
          terminalConfirmedAt: now,
          launchState: "settled",
          scenarios: settledScenarios,
          agents: settledAgents,
          completedAt: now,
          finalizedArtifactId,
          error,
          errorDetails,
          events: [
            ...testing.events,
            testEvent(
              passed ? "complete" : "error",
              passed ? "All integration and interaction tests passed." : `Test execution stopped: ${error}`
            )
          ]
        },
        review
      ),
      status: passed ? "All integration and interaction tests passed." : `Tests need attention: ${error}`,
      updatedAt: now
    };
    await persistState(next);
    publishState(prototypeId);
  });
}
async function runTestFactory(prototypeId, state, resumeFromRunId = null) {
  return runExecutionFactory(prototypeId, state, "testing", resumeFromRunId);
}
function startTestFactory(prototypeId, state, resumeFromRunId = null) {
  trackExecution(
    prototypeId,
    state,
    "testing",
    () => runTestFactory(prototypeId, state, resumeFromRunId)
  );
}
function recoverTestFactory(state, canSubmitAnswers) {
  recoverExecutionFactory(state, canSubmitAnswers, "testing");
}
async function submitUsage(entry, answer, res) {
  let accepted;
  try {
    accepted = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "requirements" || state.requirements.substage !== "usage") {
        throw new AnswerRequestError(409, "Usage intake is no longer active.");
      }
      if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "The requirements DAG is currently being updated."
        );
      }
      if (answer.length > 500 || /[\r\n]/.test(answer)) {
        throw new AnswerRequestError(
          400,
          "Enter one usage sentence of 500 characters or fewer."
        );
      }
      if (state.requirements.usageItems.length >= 30) {
        throw new AnswerRequestError(
          409,
          "Usage intake supports up to 30 items."
        );
      }
      if (state.requirements.usageItems.some(
        (item) => item.toLowerCase() === answer.toLowerCase()
      )) {
        throw new AnswerRequestError(409, "That usage is already listed.");
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID3();
      const usageItems = [...state.requirements.usageItems, answer];
      const next = {
        ...state,
        requirements: {
          ...state.requirements,
          usageItems
        },
        status: "Usage added. Generating fresh suggestions in the background...",
        suggestionProcessing: {
          status: "running",
          message: "Generating suggestions without blocking usage entry.",
          requestId,
          factoryName: SUGGESTION_FACTORY_NAME,
          runId: null,
          usageItems,
          requestedAt,
          completedAt: null
        },
        updatedAt: requestedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return { requestId, state: next, usageItems };
    }, true);
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true, usageItems: accepted.usageItems });
  startSuggestionFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.state.goal,
    accepted.usageItems
  );
}
async function submitPrototypeRevision(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const suggestion = String(body.suggestion || "").trim().slice(0, 4e3);
  if (!suggestion) {
    sendJson(res, 400, { error: "Enter a prototype revision suggestion." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Submit revisions from the installed user-scoped Tandem."
    });
    return;
  }
  let accepted;
  try {
    accepted = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "prototype") {
        throw new AnswerRequestError(
          409,
          "Prototype revisions are only available during Prototype."
        );
      }
      if (state.previewStatus !== "ready") {
        throw new AnswerRequestError(
          409,
          "Wait for the runnable preview before suggesting a revision."
        );
      }
      if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "A previous prototype revision is still being processed."
        );
      }
      if (state.prototypeReview.question) {
        throw new AnswerRequestError(
          409,
          "Answer the open clarification before adding another revision."
        );
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID3();
      const revisionId = randomUUID3();
      const question = {
        id: `prototype-revision-${revisionId}`,
        text: "Apply this prototype revision, asking for clarification only if needed.",
        rationale: "",
        choices: [],
        recommended: null,
        allowFreeText: true,
        answerPlaceholder: ""
      };
      const prototypeReview = normalizePrototypeReview({
        ...state.prototypeReview,
        revisions: [
          ...state.prototypeReview.revisions,
          {
            id: revisionId,
            suggestion,
            status: "processing",
            summary: "",
            clarifications: [],
            submittedAt: requestedAt,
            completedAt: null
          }
        ],
        activeRevisionId: revisionId,
        question: null
      });
      const pending = {
        ...state,
        phase: "iterating",
        status: "Reviewing the revision and updating the prototype...",
        prototypeReview,
        processing: {
          status: "running",
          action: "submit-revision",
          message: "A hidden agent is reviewing the prototype revision.",
          requestId,
          factoryName: ANSWER_FACTORY_NAME,
          answer: suggestion,
          runId: null,
          requestedAt,
          completedAt: null,
          question,
          originalDecisionGraph: null
        },
        updatedAt: requestedAt
      };
      await persistState(pending);
      publishState(entry.prototypeId);
      return { pending, question, requestId };
    }, true);
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startAnswerFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.question,
    suggestion,
    "submit-revision",
    accepted.pending
  );
}
async function submitRevisionClarification(entry, questionId, answer, res) {
  let accepted;
  try {
    accepted = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      const question = state.prototypeReview.question;
      if (state.lifecycle.currentStage !== "prototype" || !state.prototypeReview.activeRevisionId || !question || question.id !== questionId) {
        throw new AnswerRequestError(
          409,
          "This prototype clarification is no longer active."
        );
      }
      if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "A previous prototype revision is still being processed."
        );
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID3();
      const pending = {
        ...state,
        phase: "iterating",
        status: "Applying the clarified prototype revision...",
        processing: {
          status: "running",
          action: "clarify-revision",
          message: "A hidden agent is applying the clarification.",
          requestId,
          factoryName: ANSWER_FACTORY_NAME,
          answer,
          runId: null,
          requestedAt,
          completedAt: null,
          question,
          originalDecisionGraph: null
        },
        prototypeReview: {
          ...state.prototypeReview,
          question: null
        },
        updatedAt: requestedAt
      };
      await persistState(pending);
      publishState(entry.prototypeId);
      return { pending, question, requestId };
    }, true);
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startAnswerFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.question,
    answer,
    "clarify-revision",
    accepted.pending
  );
}
async function beginPrototypeCompletion(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    throw new CanvasError(
      "read_only_provider",
      "Finish Prototype from the installed user-scoped Tandem."
    );
  }
  const accepted = await withAnswerClaim(entry.prototypeId, async () => {
    const state = await loadState(entry.prototypeId);
    if (state.lifecycle.currentStage !== "prototype") {
      throw new CanvasError(
        "stage_not_active",
        "Only the active Prototype stage can be completed."
      );
    }
    if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
      throw new CanvasError(
        "processing_in_progress",
        "Wait for the active prototype revision to finish."
      );
    }
    const blocker = stageCompletionError(state, "prototype", {
      requirePrototypeSpec: false
    });
    if (blocker) throw new CanvasError("stage_not_ready", blocker);
    const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
    const requestId = randomUUID3();
    const question = {
      id: "generate-design-spec",
      text: "Generate the evidence-backed draft feature specification.",
      rationale: "",
      choices: [],
      recommended: null,
      allowFreeText: false,
      answerPlaceholder: ""
    };
    const pending = {
      ...state,
      status: "Collecting prototype evidence and generating the draft feature specification...",
      processing: {
        status: "running",
        action: "generate-design-spec",
        message: "A hidden agent is preparing the draft feature specification.",
        requestId,
        factoryName: ANSWER_FACTORY_NAME,
        answer: "Finish Prototype and generate the draft feature specification.",
        runId: null,
        requestedAt,
        completedAt: null,
        question,
        originalDecisionGraph: null
      },
      updatedAt: requestedAt
    };
    await persistState(pending);
    publishState(entry.prototypeId);
    return { pending, question, requestId };
  }, true);
  sendJson(res, 202, { accepted: true });
  startAnswerFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.question,
    accepted.pending.processing.answer,
    "generate-design-spec",
    accepted.pending
  );
}
async function submitAnswer(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const questionId = String(body.questionId || "").trim();
  const answer = String(body.answer || "").trim().slice(0, 4e3);
  const requestedAction = String(body.action || "").trim();
  if (!answer) {
    sendJson(res, 400, { error: "Choose or enter an answer." });
    return;
  }
  if (requestedAction && !ANSWER_ACTIONS.has(requestedAction)) {
    sendJson(res, 400, { error: "This requirements action is not supported." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Submit this answer from the installed user-scoped Tandem."
    });
    return;
  }
  if (requestedAction === "add-usage") {
    await submitUsage(entry, answer, res);
    return;
  }
  if (requestedAction === "clarify-revision") {
    await submitRevisionClarification(entry, questionId, answer, res);
    return;
  }
  let accepted;
  try {
    accepted = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "requirements") {
        throw new AnswerRequestError(
          409,
          "Requirement decisions can only change during requirements collection."
        );
      }
      const decisionGraph = normalizeDecisionGraph(
        state.decisionGraph,
        state.question
      );
      const decisionNode = decisionGraph.nodes.find(
        (node) => node.id === questionId
      );
      const isUsageIntake = state.requirements.substage === "usage" && questionId === USAGE_QUESTION_ID;
      const action = requestedAction || (isUsageIntake ? "add-usage" : "answer-decision");
      const canChangeDecision = action === "change-answer" && decisionNode?.status === "answered";
      const canAnswerDecision = action === "answer-decision" && decisionNode?.status === "active";
      const question = isUsageIntake ? usageQuestion(state.requirements.suggestions) : canAnswerDecision || canChangeDecision ? decisionNode.question : null;
      if (state.processing?.status === "running" || activeAnswerRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "A previous answer is still being processed."
        );
      }
      if (isUsageIntake && action !== "generate-dag") {
        throw new AnswerRequestError(409, "This usage action is not active.");
      }
      if (action === "generate-dag" && state.requirements.usageItems.length === 0) {
        throw new AnswerRequestError(
          409,
          "Add at least one usage before generating the DAG."
        );
      }
      if (!question || question.id !== questionId) {
        throw new AnswerRequestError(
          409,
          "This question is no longer active."
        );
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID3();
      const pendingDecisionGraph = action === "change-answer" ? invalidateDependentNodes(decisionGraph, questionId) : decisionGraph;
      const pending = {
        ...state,
        question: null,
        decisionGraph: pendingDecisionGraph,
        status: action === "add-usage" ? "Adding the usage and generating fresh suggestions..." : action === "generate-dag" ? "Generating the requirements DAG from your usages..." : action === "change-answer" ? "Updating this frontier and all dependent decisions..." : "Applying the answer and preparing the next active decision...",
        processing: {
          status: "running",
          message: PROCESSING_MESSAGES[action] || "Applying the requested Tandem update.",
          action,
          requestId,
          factoryName: ANSWER_FACTORY_NAME,
          answer,
          runId: null,
          requestedAt,
          completedAt: null,
          question,
          originalDecisionGraph: action === "change-answer" ? decisionGraph : null
        },
        updatedAt: requestedAt
      };
      await persistState(pending);
      publishState(entry.prototypeId);
      return { pending, question, requestId, action };
    }, true);
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startAnswerFactory(
    entry.prototypeId,
    accepted.requestId,
    accepted.question,
    answer,
    accepted.action,
    accepted.pending
  );
}
async function markReloadComplete(state, extensionId) {
  if (extensionId !== USER_EXTENSION_ID) return state;
  return withAnswerClaim(state.prototypeId, async () => {
    const current = await loadState(state.prototypeId);
    const receipt = current.reloadReceipt;
    if (receipt?.status !== "reloading") return current;
    const requestedAt = Date.parse(receipt.requestedAt);
    if (!Number.isFinite(requestedAt) || PROCESS_STARTED_AT <= requestedAt) {
      return current;
    }
    const completed = {
      ...current,
      reloadReceipt: {
        ...receipt,
        status: "success",
        message: "Reloaded the latest installed user extension.",
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(completed);
    return completed;
  });
}
async function recordReloadError(prototypeId, error) {
  const message = error instanceof Error ? error.message : String(error);
  await withAnswerClaim(prototypeId, async () => {
    const state = await loadState(prototypeId);
    const failed = {
      ...state,
      reloadReceipt: {
        status: "error",
        message,
        requestedAt: state.reloadReceipt?.requestedAt || (/* @__PURE__ */ new Date()).toISOString(),
        completedAt: (/* @__PURE__ */ new Date()).toISOString(),
        extensionId: USER_EXTENSION_ID
      },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(failed);
    publishState(prototypeId);
  });
  await logSafely(`Tandem extension reload failed: ${message}`);
}
async function submitReload(entry, res) {
  if (entry.extensionId !== USER_EXTENSION_ID) {
    sendJson(res, 409, {
      error: "Reload is available only from the installed user-scoped Tandem."
    });
    return;
  }
  let extensionList;
  try {
    extensionList = await session.rpc.extensions.list();
  } catch (error) {
    sendJson(res, 500, {
      error: `Could not check the installed extension: ${error instanceof Error ? error.message : String(error)}`
    });
    return;
  }
  const installed = extensionList.extensions.find(
    (extension) => extension.id === USER_EXTENSION_ID
  );
  if (!installed || installed.status !== "running") {
    sendJson(res, 409, {
      error: installed ? `The installed user extension is ${installed.status}.` : "The installed user extension is not available in this session."
    });
    return;
  }
  const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
  await withAnswerClaim(entry.prototypeId, async () => {
    const state = await loadState(entry.prototypeId);
    const reloading = {
      ...state,
      reloadReceipt: {
        status: "reloading",
        message: "Reloading the latest installed user extension...",
        requestedAt,
        completedAt: null,
        extensionId: USER_EXTENSION_ID
      },
      updatedAt: requestedAt
    };
    await persistState(reloading);
    publishState(entry.prototypeId);
  });
  sendJson(res, 202, { accepted: true, requestedAt });
  setTimeout(() => {
    session.rpc.extensions.reload().catch((error) => {
      recordReloadError(entry.prototypeId, error).catch((recordError) => {
        console.error(
          `Tandem could not record a reload failure: ${recordError instanceof Error ? recordError.message : String(recordError)}`
        );
      });
    });
  }, 150);
}
async function submitStageCompletion(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
    const stageId = String(body.stageId || "");
    if (stageId === "prototype") {
      await beginPrototypeCompletion(entry, res);
      return;
    }
    const state = await completeLifecycleStage(
      entry.prototypeId,
      stageId,
      entry.extensionId
    );
    sendJson(res, 200, publicState(entry, state));
  } catch (error) {
    if (error instanceof CanvasError) {
      sendJson(res, 409, { error: error.message, code: error.code });
      return;
    }
    throw error;
  }
}
async function submitDesignReviewRequest(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const prompt = String(body.prompt || "").trim().slice(0, 4e3);
  const type = body.type === "artifact" ? "artifact" : "question";
  const artifactKind = type === "artifact" && ["diagram", "contract", "decision-record", "test-scenario"].includes(
    body.artifactKind
  ) ? body.artifactKind : null;
  const reviewArtifactId = String(body.artifactId || "").trim().slice(0, 120);
  if (!prompt) {
    sendJson(res, 400, { error: "Enter a design question or artifact request." });
    return;
  }
  if (type === "artifact" && !artifactKind) {
    sendJson(res, 400, { error: "Choose the design artifact to generate." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for Design Review."
    });
    return;
  }
  try {
    await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "design") {
        throw new AnswerRequestError(
          409,
          "Design Review is available only during Design."
        );
      }
      const context = designReviewContext(state);
      const review = context.review;
      if (reviewArtifactId && !state.artifacts.some(
        (artifact) => artifact.id === reviewArtifactId && artifact.stage === "design"
      )) {
        throw new AnswerRequestError(
          409,
          "The selected design artifact is no longer available."
        );
      }
      if (review.threads.length >= 100) {
        throw new AnswerRequestError(
          409,
          "Resolve the current review before adding more questions."
        );
      }
      const createdAt = (/* @__PURE__ */ new Date()).toISOString();
      const thread = {
        id: randomUUID3(),
        type,
        artifactKind,
        prompt,
        answer: "",
        status: "queued",
        artifactIds: [],
        reviewArtifactId: reviewArtifactId || null,
        createdAt,
        completedAt: null,
        error: ""
      };
      const next = {
        ...state,
        artifacts: markDesignArtifactsStale(
          state.artifacts,
          null,
          context.reviewKind
        ),
        [context.reviewKey]: {
          ...review,
          threads: [...review.threads, thread],
          finalizeRequested: false,
          finalizedArtifactId: null
        },
        status: type === "artifact" ? `${context.reviewKind === "test" ? "Test design" : "Product design"} artifact request queued.` : `${context.reviewKind === "test" ? "Test design" : "Product design"} question queued.`,
        updatedAt: createdAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startDesignReviewQueue(entry.prototypeId);
}
async function submitDesignThreadAction(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const threadId = String(body.threadId || "").trim();
  const action = String(body.action || "").trim();
  if (!threadId || !["resolve", "reopen", "retry"].includes(action)) {
    sendJson(res, 400, { error: "Invalid Design Review thread action." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for Design Review."
    });
    return;
  }
  let shouldStartQueue = false;
  try {
    const state = await withAnswerClaim(entry.prototypeId, async () => {
      const current = await loadState(entry.prototypeId);
      if (current.lifecycle.currentStage !== "design") {
        throw new AnswerRequestError(
          409,
          "Design Review is available only during Design."
        );
      }
      const context = designReviewContext(current);
      const review = context.review;
      const thread = review.threads.find(
        (candidate) => candidate.id === threadId
      );
      if (!thread) {
        throw new AnswerRequestError(404, "Design Review thread not found.");
      }
      let nextStatus;
      if (action === "resolve" && thread.status === "answered") {
        nextStatus = "resolved";
      } else if (action === "reopen" && thread.status === "resolved") {
        nextStatus = "answered";
      } else if (action === "retry" && thread.status === "failed") {
        nextStatus = "queued";
        shouldStartQueue = true;
      } else {
        throw new AnswerRequestError(
          409,
          `The ${action} action is not available for this thread.`
        );
      }
      const threads = review.threads.map(
        (candidate) => candidate.id === threadId ? {
          ...candidate,
          status: nextStatus,
          error: action === "retry" ? "" : candidate.error
        } : candidate
      );
      const invalidatesReview = action !== "resolve";
      const next = {
        ...current,
        artifacts: invalidatesReview ? markDesignArtifactsStale(
          current.artifacts,
          threadId,
          context.reviewKind
        ) : current.artifacts,
        [context.reviewKey]: {
          ...review,
          threads,
          finalizeRequested: invalidatesReview ? false : review.finalizeRequested,
          finalizedArtifactId: invalidatesReview ? null : review.finalizedArtifactId
        },
        status: action === "resolve" ? `${context.reviewKind === "test" ? "Test design" : "Product design"} answer resolved.` : action === "reopen" ? `${context.reviewKind === "test" ? "Test design" : "Product design"} answer reopened for follow-up.` : `${context.reviewKind === "test" ? "Test design" : "Product design"} request queued for retry.`,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
    sendJson(res, 200, publicState(entry, state));
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  if (shouldStartQueue) startDesignReviewQueue(entry.prototypeId);
}
async function submitDesignReviewFinalization(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for Design Review."
    });
    return;
  }
  try {
    await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "design") {
        throw new AnswerRequestError(
          409,
          "Only the active Design stage can be reviewed."
        );
      }
      const context = designReviewContext(state);
      const review = context.review;
      if (review.processing || review.threads.some((thread) => thread.status !== "resolved")) {
        throw new AnswerRequestError(
          409,
          "Resolve every answered question and wait for queued work before finishing the review."
        );
      }
      const next = {
        ...state,
        artifacts: markDesignArtifactsStale(
          state.artifacts,
          null,
          context.reviewKind
        ),
        [context.reviewKey]: {
          ...review,
          finalizeRequested: true,
          finalizedArtifactId: null
        },
        status: `Final ${context.reviewKind} design specification requested.`,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await persistState(next);
      publishState(entry.prototypeId);
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startDesignReviewQueue(entry.prototypeId);
}
async function submitPlanningRequest(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const requestedAction = body.action === "revise" ? "revise" : "generate";
  const instruction = String(body.instruction || "").trim().slice(0, 4e3);
  const maxAgents = Math.max(
    1,
    Math.min(30, Number.parseInt(body.maxAgents, 10) || 4)
  );
  if (requestedAction === "revise" && !instruction) {
    sendJson(res, 400, { error: "Describe how the execution plan should change." });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for execution planning."
    });
    return;
  }
  let pending;
  try {
    pending = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "plan") {
        throw new AnswerRequestError(
          409,
          "Execution planning is available only during Plan."
        );
      }
      const planning = normalizePlanning(state.planning);
      if (planning.processing || activePlanningRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "Wait for the active execution-planning request to finish."
        );
      }
      if (requestedAction === "revise" && planning.workItems.length === 0) {
        throw new AnswerRequestError(
          409,
          "Generate the initial execution plan before revising it."
        );
      }
      const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
      const requestId = randomUUID3();
      const next = {
        ...state,
        artifacts: markExecutionPlanStale(state.artifacts),
        planning: {
          ...planning,
          status: requestedAction === "revise" ? "revising" : "generating",
          maxAgents,
          processing: {
            requestId,
            action: requestedAction,
            instruction: instruction || "Generate an efficient implementation execution plan.",
            runId: null,
            requestedAt
          },
          finalizedArtifactId: null,
          error: ""
        },
        status: requestedAction === "revise" ? "Revising the execution plan..." : "Generating the execution plan...",
        updatedAt: requestedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startPlanningFactory(
    entry.prototypeId,
    pending.planning.processing.requestId,
    pending
  );
}
async function submitPlanningFinalization(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem for execution planning."
    });
    return;
  }
  try {
    const state = await withAnswerClaim(entry.prototypeId, async () => {
      const current = await loadState(entry.prototypeId);
      if (current.lifecycle.currentStage !== "plan") {
        throw new AnswerRequestError(
          409,
          "Only the active Plan stage can be finalized."
        );
      }
      const planning = normalizePlanning(current.planning);
      if (planning.processing || planning.status !== "ready" || planning.workItems.length === 0 || planning.waves.length === 0) {
        throw new AnswerRequestError(
          409,
          "Generate a valid execution plan before finalizing it."
        );
      }
      if (current.artifacts.length >= 30 && !current.artifacts.some(
        (artifact2) => artifact2.id === "execution-plan"
      )) {
        throw new AnswerRequestError(
          409,
          "Remove one artifact before capturing the execution plan."
        );
      }
      const artifact = executionPlanArtifact(current);
      const artifacts = normalizeArtifacts([
        artifact,
        ...current.artifacts.filter(
          (candidate) => candidate.id !== artifact.id
        )
      ]);
      const completedAt = (/* @__PURE__ */ new Date()).toISOString();
      const next = {
        ...current,
        artifacts,
        planning: {
          ...planning,
          status: "complete",
          processing: null,
          finalizedArtifactId: artifact.id,
          error: ""
        },
        implementation: resetImplementationForPlan(
          planning,
          current.implementation
        ),
        status: "Execution plan captured. Plan can now be completed.",
        updatedAt: completedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
    sendJson(res, 200, publicState(entry, state));
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
}
async function submitImplementationStart(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to run implementation."
    });
    return;
  }
  let pending;
  try {
    pending = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      const planning = normalizePlanning(state.planning);
      if (state.lifecycle.currentStage !== "implement") {
        throw new AnswerRequestError(
          409,
          "Implementation can start only during the Implement stage."
        );
      }
      if (planning.status !== "complete" || planning.finalizedArtifactId !== "execution-plan") {
        throw new AnswerRequestError(
          409,
          "Finalize the execution plan before starting implementation."
        );
      }
      const implementation = normalizeImplementation(
        state.implementation,
        planning
      );
      const inputRevision = executionInputRevision(state, "implementation");
      const retainCompleted = implementation.inputRevision === inputRevision && implementation.workspaceRoot === executionWorkspace(WORKSPACE_ROOT);
      if (["starting", "running"].includes(implementation.status) || activeImplementationRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(
          409,
          "Implementation agents are already running."
        );
      }
      if (implementation.status === "completed" && retainCompleted) {
        throw new AnswerRequestError(
          409,
          "Implementation is already complete."
        );
      }
      await assertPreviousExecutionStopped(implementation);
      const startedAt = (/* @__PURE__ */ new Date()).toISOString();
      const retrying = implementation.workItems.some(
        (item) => item.status === "completed" || ["failed", "blocked", "cancelled"].includes(item.status)
      );
      const nextImplementation = normalizeImplementation(
        {
          ...implementation,
          ...newExecution(inputRevision, WORKSPACE_ROOT, session.sessionId),
          waveManifests: [],
          status: "starting",
          runId: null,
          currentWaveIndex: 0,
          workItems: implementation.workItems.map(
            (item) => retainCompleted && item.status === "completed" && item.summary && item.validation.length > 0 && item.blockers.length === 0 ? item : {
              ...item,
              status: "pending",
              agentId: "",
              summary: "",
              filesChanged: [],
              validation: [],
              blockers: [],
              startedAt: null,
              completedAt: null
            }
          ),
          agents: implementation.agents.filter(
            (agent) => retainCompleted && implementation.workItems.find(
              (item) => item.id === agent.workItemId
            )?.status === "completed"
          ),
          startedAt,
          completedAt: null,
          finalizedArtifactId: null,
          error: "",
          events: [
            ...implementation.events,
            implementationEvent(
              "start",
              retrying ? "Retrying incomplete implementation work." : "Implementation run requested."
            )
          ]
        },
        planning
      );
      const next = {
        ...state,
        artifacts: markFinalCodeStale(state.artifacts),
        implementation: nextImplementation,
        status: retrying ? "Retrying incomplete implementation work..." : "Starting implementation agents...",
        updatedAt: startedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startImplementationFactory(entry.prototypeId, pending);
}
async function submitImplementationStrategy(entry, req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : "Invalid request."
    });
    return;
  }
  const text = String(body.text || "").trim().slice(0, 4e3);
  if (!text) {
    sendJson(res, 400, {
      error: "Describe the execution strategy adjustment."
    });
    return;
  }
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to adjust implementation."
    });
    return;
  }
  try {
    const state = await withAnswerClaim(entry.prototypeId, async () => {
      const current = await loadState(entry.prototypeId);
      const planning = normalizePlanning(current.planning);
      const implementation = normalizeImplementation(
        current.implementation,
        planning
      );
      if (current.lifecycle.currentStage !== "implement") {
        throw new AnswerRequestError(
          409,
          "Strategy adjustments are available only during Implement."
        );
      }
      if (implementation.status === "completed") {
        throw new AnswerRequestError(
          409,
          "Implementation is already complete."
        );
      }
      if (["starting", "running"].includes(implementation.status)) {
        assertCurrentExecution(current, "implementation", executionToken(implementation), !implementation.runId);
      }
      if (implementation.status === "running") {
        const hasFutureWave = planning.waves.some(
          (wave) => wave.index > implementation.currentWaveIndex && wave.workItemIds.some(
            (id) => implementation.workItems.find(
              (item) => item.id === id
            )?.status !== "completed"
          )
        );
        if (!hasFutureWave) {
          throw new AnswerRequestError(
            409,
            "No later wave is available for a safe adjustment. Stop the run and retry incomplete work to apply new guidance."
          );
        }
      }
      const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
      const next = {
        ...current,
        implementation: normalizeImplementation(
          {
            ...implementation,
            strategySuggestions: [
              ...implementation.strategySuggestions,
              {
                id: randomUUID3(),
                text,
                status: "queued",
                submittedAt,
                appliedAt: null,
                waveIndex: null
              }
            ],
            events: [
              ...implementation.events,
              implementationEvent(
                "strategy",
                "A strategy adjustment was queued for the next wave."
              )
            ]
          },
          planning
        ),
        status: implementation.status === "running" ? "Strategy adjustment queued for the next wave." : "Strategy adjustment saved for the next implementation run.",
        updatedAt: submittedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
    sendJson(res, 200, publicState(entry, state));
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
}
async function submitImplementationStop(entry, res) {
  return submitExecutionStop(entry, res, "implementation");
}
async function submitTestStop(entry, res) {
  return submitExecutionStop(entry, res, "testing");
}
async function submitExecutionStop(entry, res, kind) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to stop execution."
    });
    return;
  }
  try {
    const request = await requestExecutionCancellation(
      entry.prototypeId,
      kind,
      null,
      "Stop requested by the user.",
      "cancelled"
    );
    await performExecutionCancellation(entry.prototypeId, kind, request.token, request.cancellationId);
    sendJson(res, 200, { accepted: true, stopped: true });
  } catch (error) {
    if (error instanceof AnswerRequestError || error instanceof ExecutionCancellationPendingError) {
      sendJson(res, error.statusCode, { error: error.message, stopped: false, retryable: true });
      return;
    }
    if (error instanceof ExecutionSupersededError) {
      sendJson(res, 409, { error: error.message, stopped: false });
      return;
    }
    throw error;
  }
}
async function implementationRuntimeState(entry) {
  const state = await loadState(entry.prototypeId);
  const payload = publicState(entry, state);
  const runId = state.implementation.runId;
  if (!runId) return { ...payload, implementationRuntime: null };
  try {
    const detail = await session.factory.getRunDetail(runId);
    return {
      ...payload,
      implementationRuntime: {
        runId: detail.runId,
        status: detail.status,
        currentPhase: detail.currentPhase?.id || null,
        liveAgentCount: detail.liveAgentCount,
        totalSpawnedAgentCount: detail.totalSpawnedAgentCount,
        consumed: detail.consumed,
        agents: detail.agents.filter((agent) => agent.label.startsWith("work:")).map((agent) => ({
          id: agent.agentId,
          label: agent.label,
          status: agent.status,
          model: agent.resolvedModel || agent.requestedModel || "",
          activity: agent.activity || "",
          activeMs: agent.activeMs,
          startedAt: agent.startedAt || null,
          completedAt: agent.completedAt || null
        })),
        progress: detail.progress.records.slice(-50).map((record) => ({
          seq: record.seq,
          text: record.text,
          kind: record.kind,
          recordedAt: record.recordedAt
        }))
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Factory observability is unavailable.";
    await logSafely(
      `Tandem could not read implementation runtime details: ${message}`,
      "warning"
    );
    return {
      ...payload,
      implementationRuntime: {
        runId,
        status: "unavailable",
        currentPhase: null,
        liveAgentCount: 0,
        totalSpawnedAgentCount: 0,
        consumed: null,
        agents: [],
        progress: [],
        error: message
      }
    };
  }
}
async function submitTestStart(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to run tests."
    });
    return;
  }
  let pending;
  try {
    pending = await withAnswerClaim(entry.prototypeId, async () => {
      const state = await loadState(entry.prototypeId);
      if (state.lifecycle.currentStage !== "test") {
        throw new AnswerRequestError(
          409,
          "Integration and interaction tests run only during Test."
        );
      }
      const review = normalizeDesignReview(state.testDesignReview);
      if (review.finalizedArtifactId !== "test-spec" || review.scenarios.length === 0) {
        throw new AnswerRequestError(
          409,
          "Finalize Test design before running tests."
        );
      }
      const testing = normalizeTesting(state.testing, review);
      const inputRevision = executionInputRevision(state, "testing");
      const sourceFingerprint = await fingerprintWorkspace(WORKSPACE_ROOT);
      const retainPassed = testing.status !== "completed" && testing.inputRevision === inputRevision && testing.sourceFingerprint === sourceFingerprint && testing.workspaceRoot === executionWorkspace(WORKSPACE_ROOT);
      if (["starting", "running"].includes(testing.status) || activeTestRuns.has(entry.prototypeId)) {
        throw new AnswerRequestError(409, "Tests are already running.");
      }
      await assertPreviousExecutionStopped(testing);
      const startedAt = (/* @__PURE__ */ new Date()).toISOString();
      const next = {
        ...state,
        stage: "test",
        phase: "building",
        lifecycle: reopenTestLifecycle(state.lifecycle),
        artifacts: markTestResultsStale(state.artifacts),
        testing: normalizeTesting(
          {
            ...testing,
            ...newExecution(inputRevision, WORKSPACE_ROOT, session.sessionId, sourceFingerprint),
            waveManifests: [],
            status: "starting",
            runId: null,
            currentWaveIndex: 0,
            scenarios: testing.scenarios.map(
              (scenario) => retainPassed && scenario.status === "passed" && scenario.summary && scenario.evidence.length > 0 ? scenario : {
                ...scenario,
                status: "pending",
                summary: "",
                evidence: [],
                startedAt: null,
                completedAt: null
              }
            ),
            agents: testing.agents.filter(
              (agent) => retainPassed && testing.scenarios.find(
                (scenario) => scenario.id === agent.scenarioId
              )?.status === "passed"
            ),
            events: [
              ...testing.events,
              testEvent("start", "Test execution requested.")
            ],
            startedAt,
            completedAt: null,
            finalizedArtifactId: null,
            error: "",
            errorDetails: ""
          },
          review
        ),
        status: "Starting integration and interaction tests...",
        updatedAt: startedAt
      };
      await persistState(next);
      publishState(entry.prototypeId);
      return next;
    });
  } catch (error) {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    throw error;
  }
  sendJson(res, 202, { accepted: true });
  startTestFactory(entry.prototypeId, pending);
}
async function testRuntimeState(entry) {
  const state = await loadState(entry.prototypeId);
  const payload = publicState(entry, state);
  const runId = state.testing.runId;
  if (!runId) return { ...payload, testRuntime: null };
  try {
    const detail = await session.factory.getRunDetail(runId);
    return {
      ...payload,
      testRuntime: {
        runId,
        status: detail.status,
        currentPhase: detail.currentPhase?.id || null,
        liveAgentCount: detail.liveAgentCount,
        consumed: detail.consumed,
        agents: detail.agents.filter((agent) => agent.label.startsWith("test:")).map((agent) => ({
          label: agent.label,
          status: agent.status,
          model: agent.resolvedModel || agent.requestedModel || "",
          activity: agent.activity || "",
          activeMs: agent.activeMs
        })),
        progress: detail.progress.records.slice(-50).map((record) => ({
          seq: record.seq,
          text: record.text,
          kind: record.kind,
          recordedAt: record.recordedAt
        }))
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Test observability is unavailable.";
    await logSafely(
      `Tandem could not read test runtime details: ${message}`,
      "warning"
    );
    return {
      ...payload,
      testRuntime: {
        runId,
        status: "unavailable",
        liveAgentCount: 0,
        consumed: null,
        agents: [],
        progress: [],
        error: message
      }
    };
  }
}
async function preparationRuntimeState(entry) {
  const state = await loadState(entry.prototypeId);
  const payload = publicState(entry, state);
  const runId = state.preparation.processing?.runId;
  if (!runId) return { ...payload, preparationRuntime: null };
  try {
    const detail = await session.factory.getRunDetail(runId);
    return {
      ...payload,
      preparationRuntime: {
        runId,
        status: detail.status,
        currentPhase: detail.currentPhase?.id || null,
        liveAgentCount: detail.liveAgentCount,
        agents: detail.agents.filter((agent) => agent.label.startsWith("prepare:")).map((agent) => ({
          label: agent.label,
          status: agent.status,
          model: agent.resolvedModel || agent.requestedModel || "",
          activity: agent.activity || "",
          activeMs: agent.activeMs
        })),
        progress: detail.progress.records.slice(-50).map((record) => ({
          seq: record.seq,
          text: record.text,
          kind: record.kind,
          recordedAt: record.recordedAt
        }))
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preparation observability is unavailable.";
    await logSafely(
      `Tandem could not read preparation runtime details: ${message}`,
      "warning"
    );
    return {
      ...payload,
      preparationRuntime: {
        runId,
        status: "unavailable",
        currentPhase: null,
        liveAgentCount: 0,
        agents: [],
        progress: [],
        error: message
      }
    };
  }
}
async function submitPreparationRetry(entry, res) {
  if (!await isPreferredAnswerProvider(entry.extensionId)) {
    sendJson(res, 409, {
      error: "Use the installed user-scoped Tandem to retry preparation."
    });
    return;
  }
  const state = await withAnswerClaim(entry.prototypeId, async () => {
    const current = await loadState(entry.prototypeId);
    if (current.lifecycle.currentStage !== "prepare" || current.preparation.status !== "failed") {
      throw new AnswerRequestError(
        409,
        "Preparation can be retried only after a failed preparation run."
      );
    }
    const previousRunId = current.preparation.processing?.runId;
    if (previousRunId) {
      const previous = await session.factory.getRun(previousRunId);
      if (!isFactoryRunTerminal(previous.status)) {
        throw new AnswerRequestError(409, "The previous preparation run is still active. Stop it before retrying.");
      }
    }
    const next = {
      ...current,
      preparation: normalizePreparation(null),
      status: "Retrying preparation...",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await persistState(next);
    publishState(entry.prototypeId);
    return next;
  }).catch((error) => {
    if (error instanceof AnswerRequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return null;
    }
    throw error;
  });
  if (!state) return;
  sendJson(res, 202, { accepted: true });
  await ensurePreparationStarted(state, true);
}
async function handleRequest(entry, req, res) {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && requestUrl.pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(renderTandemHtml("1.0.7"));
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/state") {
    await refreshEntryAnswerCapability(entry);
    sendJson(
      res,
      200,
      publicState(entry, await loadState(entry.prototypeId))
    );
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/preparation/status") {
    await refreshEntryAnswerCapability(entry);
    sendJson(res, 200, await preparationRuntimeState(entry));
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/implementation/status") {
    await refreshEntryAnswerCapability(entry);
    sendJson(res, 200, await implementationRuntimeState(entry));
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/test/status") {
    await refreshEntryAnswerCapability(entry);
    sendJson(res, 200, await testRuntimeState(entry));
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/events") {
    await refreshEntryAnswerCapability(entry);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    entry.clients.add(res);
    const state = await loadState(entry.prototypeId);
    res.write(`data: ${JSON.stringify(publicState(entry, state))}

`);
    req.on("close", () => entry.clients.delete(res));
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/answer") {
    await submitAnswer(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/revision") {
    await submitPrototypeRevision(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/design-review") {
    await submitDesignReviewRequest(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/design-review/thread") {
    await submitDesignThreadAction(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/design-review/finalize") {
    await submitDesignReviewFinalization(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/plan/generate") {
    await submitPlanningRequest(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/plan/finalize") {
    await submitPlanningFinalization(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/implementation/start") {
    await submitImplementationStart(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/implementation/strategy") {
    await submitImplementationStrategy(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/implementation/stop") {
    await submitImplementationStop(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/test/start") {
    await submitTestStart(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/test/stop") {
    await submitTestStop(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/preparation/retry") {
    await submitPreparationRetry(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/reload") {
    await submitReload(entry, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/stage/complete") {
    await submitStageCompletion(entry, req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/prototype/start") {
    const state = await beginPrototypeBuild(entry.prototypeId, entry.extensionId);
    sendJson(res, 202, publicState(entry, state));
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/stage/reopen") {
    const body = await readRequestBody(req);
    if (!isObject(body) || typeof body.stageId !== "string") {
      sendJson(res, 400, { error: "Select the stage to reopen." });
      return;
    }
    const state = await reopenLifecycleStage(entry.prototypeId, body.stageId, entry.extensionId);
    sendJson(res, 200, publicState(entry, state));
    return;
  }
  sendJson(res, 404, { error: "Not found." });
}
async function startServer(instanceId, prototypeId, extensionId, canSubmitAnswers) {
  const entry = {
    instanceId,
    prototypeId,
    extensionId,
    canSubmitAnswers,
    clients: /* @__PURE__ */ new Set(),
    server: null,
    heartbeat: null,
    url: ""
  };
  const server = createServer((req, res) => {
    handleRequest(entry, req, res).catch(async (error) => {
      if (!res.headersSent) {
        sendJson(res, error instanceof ProjectStoreError || error instanceof AnswerRequestError ? error.statusCode : error instanceof CanvasError ? 409 : 500, {
          error: error instanceof Error ? error.message : "Tandem request failed."
        });
      } else {
        res.end();
      }
      await logSafely(
        `Tandem request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  });
  await new Promise((resolve3, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve3());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  entry.server = server;
  entry.url = `http://127.0.0.1:${port}/`;
  entry.heartbeat = setInterval(() => {
    for (const client of entry.clients) client.write(": keepalive\n\n");
  }, 2e4);
  return entry;
}
var questionSchema = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1 },
        text: { type: "string", minLength: 1 },
        rationale: { type: "string" },
        choices: {
          type: "array",
          maxItems: 6,
          items: { type: "string", minLength: 1 }
        },
        recommended: { type: ["string", "null"] },
        allowFreeText: { type: "boolean" },
        answerPlaceholder: { type: "string" }
      },
      required: ["id", "text"]
    }
  ]
};
var decisionNodeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    dependencies: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    },
    question: questionSchema,
    answer: { type: ["string", "null"] },
    status: {
      type: "string",
      enum: ["answered", "active", "toAnswer"]
    }
  },
  required: ["id", "title", "dependencies", "question", "answer"]
};
var decisionGraphSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      maxItems: 50,
      items: decisionNodeSchema
    }
  },
  required: ["nodes"]
};
var requirementsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    substage: {
      type: "string",
      enum: ["usage", "dag"]
    },
    usageItems: {
      type: "array",
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    },
    suggestions: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1 }
    }
  },
  required: ["substage", "usageItems", "suggestions"]
};
var preparationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: [
        "not-started",
        "starting",
        "running",
        "ready",
        "needs-attention",
        "failed"
      ]
    },
    summary: { type: "string", maxLength: 2e3 },
    workItems: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 120 },
          title: { type: "string", minLength: 1, maxLength: 160 },
          status: {
            type: "string",
            enum: ["pending", "running", "completed", "failed"]
          },
          detail: { type: "string", maxLength: 1e3 },
          result: { type: "string", maxLength: 4e3 }
        },
        required: ["id", "title", "status", "detail", "result"]
      }
    },
    messages: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 120 },
          text: { type: "string", minLength: 1, maxLength: 2e3 },
          kind: {
            type: "string",
            enum: ["info", "success", "warning", "error"]
          },
          at: { type: "string" }
        },
        required: ["id", "text", "kind", "at"]
      }
    },
    checks: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string", minLength: 1, maxLength: 120 },
          status: {
            type: "string",
            enum: ["ready", "missing", "deferred"]
          },
          detail: { type: "string", maxLength: 500 }
        },
        required: ["label", "status", "detail"]
      }
    },
    sources: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          url: { type: "string", minLength: 1, maxLength: 1e3 },
          purpose: { type: "string", maxLength: 500 }
        },
        required: ["title", "url", "purpose"]
      }
    },
    suggestedUsages: {
      type: "array",
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 500 }
    },
    processing: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            requestId: { type: ["string", "null"] },
            generation: { type: ["string", "null"] },
            runId: { type: ["string", "null"] },
            requestedAt: { type: "string" },
            completedAt: { type: ["string", "null"] }
          },
          required: ["runId", "requestedAt", "completedAt"]
        }
      ]
    },
    error: { type: "string", maxLength: 4e3 }
  },
  required: [
    "status",
    "summary",
    "workItems",
    "messages",
    "checks",
    "sources",
    "suggestedUsages",
    "processing",
    "error"
  ]
};
var preparationCheckSchema = preparationSchema.properties.checks.items;
var preparationSourceSchema = preparationSchema.properties.sources.items;
var preparationWorkspaceOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 4e3 },
    checks: {
      type: "array",
      maxItems: 10,
      items: preparationCheckSchema
    }
  },
  required: ["summary", "checks"]
};
var preparationSourcesOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 4e3 },
    sources: {
      type: "array",
      maxItems: 20,
      items: preparationSourceSchema
    },
    checks: {
      type: "array",
      maxItems: 10,
      items: preparationCheckSchema
    }
  },
  required: ["summary", "sources", "checks"]
};
var preparationFactoryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["ready", "needs-attention"]
    },
    summary: { type: "string", minLength: 1, maxLength: 2e3 },
    checks: {
      type: "array",
      maxItems: 20,
      items: preparationCheckSchema
    },
    sources: {
      type: "array",
      maxItems: 20,
      items: preparationSourceSchema
    },
    suggestedUsages: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 500 }
    },
    assumed: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 500 }
    },
    deferred: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 500 }
    },
    prototypeApproach: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: [
            "undecided",
            "build",
            "validate-existing",
            "not-applicable"
          ]
        },
        reason: { type: "string", minLength: 1, maxLength: 500 }
      },
      required: ["mode", "reason"]
    }
  },
  required: [
    "status",
    "summary",
    "checks",
    "sources",
    "suggestedUsages",
    "assumed",
    "deferred",
    "prototypeApproach"
  ]
};
var prototypeApproachSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: {
      type: "string",
      enum: [
        "undecided",
        "build",
        "validate-existing",
        "not-applicable"
      ]
    },
    reason: { type: "string", minLength: 1, maxLength: 500 }
  },
  required: ["mode", "reason"]
};
var revisionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    suggestion: { type: "string", minLength: 1 },
    status: {
      type: "string",
      enum: ["processing", "clarifying", "applied", "failed"]
    },
    summary: { type: "string" },
    clarifications: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string", minLength: 1 },
          answer: { type: "string", minLength: 1 }
        },
        required: ["question", "answer"]
      }
    },
    submittedAt: { type: "string" },
    completedAt: { type: ["string", "null"] }
  },
  required: [
    "id",
    "suggestion",
    "status",
    "summary",
    "clarifications",
    "submittedAt",
    "completedAt"
  ]
};
var evidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    content: { type: "string", minLength: 1 },
    recordedAt: { type: "string" }
  },
  required: ["id", "type", "content", "recordedAt"]
};
var prototypeReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    revisions: {
      type: "array",
      maxItems: 50,
      items: revisionSchema
    },
    activeRevisionId: { type: ["string", "null"] },
    question: questionSchema,
    evidence: {
      type: "array",
      maxItems: 100,
      items: evidenceSchema
    },
    designSpecArtifactId: { type: ["string", "null"] }
  },
  required: [
    "revisions",
    "activeRevisionId",
    "question",
    "evidence",
    "designSpecArtifactId"
  ]
};
var designReviewThreadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["question", "artifact"] },
    artifactKind: {
      type: ["string", "null"],
      enum: [
        "diagram",
        "contract",
        "decision-record",
        "test-scenario",
        null
      ]
    },
    prompt: { type: "string", minLength: 1 },
    answer: { type: "string" },
    status: {
      type: "string",
      enum: ["queued", "processing", "answered", "resolved", "failed"]
    },
    artifactIds: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    },
    reviewArtifactId: { type: ["string", "null"] },
    createdAt: { type: "string" },
    completedAt: { type: ["string", "null"] },
    error: { type: "string" }
  },
  required: [
    "id",
    "type",
    "artifactKind",
    "prompt",
    "answer",
    "status",
    "artifactIds",
    "createdAt",
    "completedAt",
    "error"
  ]
};
var testScenarioSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    type: { type: "string", enum: ["integration", "interaction"] },
    description: { type: "string", minLength: 1 },
    dependencies: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    },
    expectedOutcome: { type: "string", minLength: 1 },
    validation: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    }
  },
  required: [
    "id",
    "title",
    "type",
    "description",
    "dependencies",
    "steps",
    "expectedOutcome",
    "validation"
  ]
};
var designReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    threads: {
      type: "array",
      maxItems: 100,
      items: designReviewThreadSchema
    },
    processing: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1 },
            action: {
              type: "string",
              enum: ["process-thread", "finalize"]
            },
            threadId: { type: ["string", "null"] },
            runId: { type: ["string", "null"] },
            requestedAt: { type: "string" }
          },
          required: [
            "requestId",
            "action",
            "threadId",
            "runId",
            "requestedAt"
          ]
        }
      ]
    },
    finalizeRequested: { type: "boolean" },
    finalizedArtifactId: { type: ["string", "null"] },
    scenarios: {
      type: "array",
      maxItems: 30,
      items: testScenarioSchema
    }
  },
  required: [
    "threads",
    "processing",
    "finalizeRequested",
    "finalizedArtifactId"
  ]
};
var planWorkItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    dependencies: {
      type: "array",
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    },
    agentRole: { type: "string", minLength: 1 },
    agentId: { type: "string" },
    estimatedHours: { type: "number", minimum: 0.5, maximum: 80 },
    files: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    },
    skills: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    },
    acceptanceCriteria: {
      type: "array",
      maxItems: 30,
      items: { type: "string", minLength: 1 }
    },
    validation: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 }
    }
  },
  required: [
    "id",
    "title",
    "description",
    "dependencies",
    "agentRole",
    "estimatedHours",
    "files",
    "skills",
    "acceptanceCriteria",
    "validation"
  ]
};
var planningSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["idle", "generating", "revising", "ready", "complete", "failed"]
    },
    summary: { type: "string" },
    strategy: { type: "string" },
    maxAgents: { type: "integer", minimum: 1, maximum: 30 },
    workItems: {
      type: "array",
      maxItems: 30,
      items: planWorkItemSchema
    },
    waves: { type: "array" },
    agents: { type: "array" },
    risks: {
      type: "array",
      maxItems: 50,
      items: { type: "string" }
    },
    revisionHistory: {
      type: "array",
      maxItems: 30,
      items: { type: "string" }
    },
    metrics: { type: "object" },
    processing: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            requestId: { type: "string", minLength: 1 },
            action: {
              type: "string",
              enum: ["generate", "revise"]
            },
            instruction: { type: "string" },
            runId: { type: ["string", "null"] },
            requestedAt: { type: "string" }
          },
          required: [
            "requestId",
            "action",
            "instruction",
            "runId",
            "requestedAt"
          ]
        }
      ]
    },
    finalizedArtifactId: { type: ["string", "null"] },
    error: { type: "string" }
  },
  required: [
    "status",
    "summary",
    "strategy",
    "maxAgents",
    "workItems",
    "waves",
    "agents",
    "risks",
    "revisionHistory",
    "metrics",
    "processing",
    "finalizedArtifactId",
    "error"
  ]
};
var planningFactoryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1 },
    strategy: { type: "string", minLength: 1 },
    workItems: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: planWorkItemSchema
    },
    risks: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    }
  },
  required: ["summary", "strategy", "workItems", "risks"]
};
var executionValidationSchema = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    properties: {
      requirement: { type: "string" },
      status: { type: "string", enum: ["passed", "failed", "skipped"] },
      evidence: { type: "string" }
    },
    required: ["requirement", "status", "evidence"]
  }
};
var implementationAgentOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["completed", "failed"] },
    summary: { type: "string", minLength: 1 },
    filesChanged: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1 }
    },
    validation: executionValidationSchema,
    blockers: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    }
  },
  required: [
    "status",
    "summary",
    "filesChanged",
    "validation",
    "blockers"
  ]
};
var testAgentOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["passed", "failed"] },
    summary: { type: "string", minLength: 1 },
    evidence: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    },
    validation: executionValidationSchema,
    blockers: { type: "array", items: { type: "string" } }
  },
  required: ["status", "summary", "evidence", "validation", "blockers"]
};
var artifactSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    kind: { type: "string" },
    stage: {
      type: "string",
      enum: [
        "prepare",
        "requirements",
        "prototype",
        "design",
        "plan",
        "implement",
        "test"
      ]
    },
    path: { type: "string" },
    language: { type: "string" },
    content: { type: "string" },
    mermaid: { type: "string" },
    sourceThreadIds: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1 }
    },
    reviewStatus: {
      type: "string",
      enum: ["current", "stale"]
    }
  },
  required: ["id", "title", "content"]
};
var answerFactoryArtifactSchema = {
  ...artifactSchema,
  required: [
    "id",
    "title",
    "kind",
    "stage",
    "path",
    "language",
    "content",
    "mermaid"
  ]
};
var designReviewArtifactSchema = {
  ...artifactSchema,
  required: [
    "id",
    "title",
    "kind",
    "stage",
    "path",
    "language",
    "content",
    "mermaid",
    "sourceThreadIds",
    "reviewStatus"
  ]
};
var designReviewFactoryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string", minLength: 1 },
    artifacts: {
      type: "array",
      maxItems: 5,
      items: designReviewArtifactSchema
    },
    testScenarios: {
      type: "array",
      maxItems: 30,
      items: testScenarioSchema
    }
  },
  required: ["answer", "artifacts", "testScenarios"]
};
var answerFactoryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goal: { type: "string" },
    phase: {
      type: "string",
      enum: ["discovery", "building", "iterating", "complete"]
    },
    status: { type: "string" },
    prototypeApproach: prototypeApproachSchema,
    requirements: requirementsSchema,
    prototypeReview: prototypeReviewSchema,
    question: questionSchema,
    decisionGraph: decisionGraphSchema,
    confirmed: {
      type: "array",
      items: { type: "string" }
    },
    assumed: {
      type: "array",
      items: { type: "string" }
    },
    deferred: {
      type: "array",
      items: { type: "string" }
    },
    artifactChanges: {
      type: "object",
      properties: {
        upsert: {
          type: "array",
          items: answerFactoryArtifactSchema
        },
        remove: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["upsert", "remove"]
    },
    previewUrl: {
      type: ["string", "null"]
    },
    previewStatus: {
      type: "string",
      enum: ["waiting", "starting", "ready", "error"]
    }
  },
  required: [
    "goal",
    "phase",
    "status",
    "prototypeApproach",
    "requirements",
    "prototypeReview",
    "question",
    "decisionGraph",
    "confirmed",
    "assumed",
    "deferred",
    "artifactChanges",
    "previewUrl",
    "previewStatus"
  ]
};
var preparationFactory = defineFactory({
  meta: {
    name: PREPARATION_FACTORY_NAME,
    description: "Inspect the workspace and authoritative sources, then prepare the Requirements handoff.",
    phases: [
      {
        title: "Inspect workspace",
        detail: "Identify repository structure, tooling, and execution constraints."
      },
      {
        title: "Analyze sources",
        detail: "Ground named products, methods, and benchmarks in authoritative sources."
      },
      {
        title: "Prepare requirements",
        detail: "Synthesize usages, assumptions, and prototype guidance."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string", minLength: 1 },
        projectRoot: { type: "string", minLength: 1 },
        goal: { type: "string" },
        requestId: { type: "string", minLength: 1 },
        generation: { type: "string", minLength: 1 }
      },
      required: ["prototypeId", "projectRoot", "goal", "requestId", "generation"]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 3,
      timeoutSeconds: 240,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !String(args.prototypeId || "").trim() || typeof args.requestId !== "string" || !args.requestId || typeof args.generation !== "string" || !args.generation || !sameOwner(
      { sessionId: session.sessionId, workspaceRoot: String(args.projectRoot || "") },
      { sessionId: session.sessionId, workspaceRoot: WORKSPACE_ROOT }
    )) {
      throw new Error("Preparation factory arguments are invalid.");
    }
    const token = { requestId: args.requestId, generation: args.generation, runId: ctx.runId };
    if (!await bindPreparationRun(args.prototypeId, token)) {
      throw new CanvasError("preparation_superseded", "This preparation request is no longer active.");
    }
    ctx.phase("Inspect workspace");
    ctx.log("Inspecting repository structure and required tooling.");
    await recordPreparationWorkItem(
      args.prototypeId,
      "workspace",
      "running",
      token
    );
    const workspaceAnalysis = await ctx.step(
      `${token.requestId}:inspect-workspace`,
      async () => jsonResult(await ctx.agent(preparationWorkspacePrompt(args), {
        label: "prepare:workspace",
        schema: preparationWorkspaceOutputSchema,
        reasoningEffort: "low"
      }))
    );
    await recordPreparationWorkItem(
      args.prototypeId,
      "workspace",
      "completed",
      token,
      workspaceAnalysis.summary
    );
    ctx.phase("Analyze sources");
    ctx.log("Reading authoritative sources for named concepts.");
    await recordPreparationWorkItem(
      args.prototypeId,
      "sources",
      "running",
      token
    );
    const sourceAnalysis = await ctx.step(
      `${token.requestId}:analyze-sources`,
      async () => jsonResult(await ctx.agent(preparationSourcesPrompt(args, workspaceAnalysis), {
        label: "prepare:sources",
        schema: preparationSourcesOutputSchema,
        reasoningEffort: "medium"
      }))
    );
    await recordPreparationWorkItem(
      args.prototypeId,
      "sources",
      "completed",
      token,
      sourceAnalysis.summary
    );
    ctx.phase("Prepare requirements");
    ctx.log("Synthesizing preparation findings into Requirements suggestions.");
    await recordPreparationWorkItem(
      args.prototypeId,
      "requirements-handoff",
      "running",
      token
    );
    const handoff = await ctx.step(
      `${token.requestId}:prepare-requirements`,
      async () => jsonResult(await ctx.agent(
        preparationHandoffPrompt(
          args,
          workspaceAnalysis,
          sourceAnalysis
        ),
        {
          label: "prepare:requirements",
          schema: preparationFactoryOutputSchema,
          reasoningEffort: "medium"
        }
      ))
    );
    const checks = [
      ...workspaceAnalysis.checks,
      ...sourceAnalysis.checks
    ].filter(
      (entry, index, entries) => entries.findIndex(
        (candidate) => String(candidate.label).toLowerCase() === String(entry.label).toLowerCase()
      ) === index
    );
    const result = {
      ...handoff,
      status: checks.some((check) => check.status === "missing") ? "needs-attention" : handoff.status,
      checks,
      sources: sourceAnalysis.sources
    };
    await recordPreparationWorkItem(
      args.prototypeId,
      "requirements-handoff",
      "completed",
      token,
      result.summary
    );
    ctx.log("Preparation handoff is ready.");
    return result;
  }
});
var usageSuggestionFactory = defineFactory({
  meta: {
    name: SUGGESTION_FACTORY_NAME,
    description: "Generate complementary one-sentence usage suggestions without blocking usage entry.",
    phases: [
      {
        title: "Generate suggestions",
        detail: "Find useful app usages not already captured."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string" },
        requestId: { type: "string" },
        goal: { type: "string" },
        usageItems: {
          type: "array",
          maxItems: 30,
          items: { type: "string", minLength: 1 }
        }
      },
      required: ["prototypeId", "requestId", "goal", "usageItems"]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 1,
      timeoutSeconds: 120,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !String(args.prototypeId || "").trim() || !String(args.requestId || "").trim() || !Array.isArray(args.usageItems)) {
      throw new Error("Usage suggestion factory arguments are invalid.");
    }
    ctx.phase("Generate suggestions");
    ctx.log(`Request ${args.requestId}; prototype ${args.prototypeId}.`);
    return ctx.agent(
      [
        "Generate 3 to 5 concise suggestions for ways the user wants to use",
        "this deliverable. Start every suggestion with 'I want to'.",
        "Each suggestion must be one standalone sentence written",
        "in the first person, actionable, and suitable for a one-click add button.",
        "Do not repeat, paraphrase, combine, or contradict an existing usage.",
        "When no usages exist yet, provide diverse starter suggestions grounded in",
        "the goal. If the goal is empty, provide broadly useful starter usages",
        "that help the user describe the product they want.",
        "Return only the structured output required by the schema.",
        "",
        `Goal: ${String(args.goal || "").trim()}`,
        "Existing usages:",
        ...args.usageItems.length > 0 ? args.usageItems.map((item) => `- ${item}`) : ["- None yet"]
      ].join("\n"),
      {
        label: "Generate usage suggestions",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            suggestions: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: { type: "string", minLength: 1 }
            }
          },
          required: ["suggestions"]
        },
        reasoningEffort: "low"
      }
    );
  }
});
var designReviewFactory = defineFactory({
  meta: {
    name: DESIGN_REVIEW_FACTORY_NAME,
    description: "Answer one queued Design Review request or synthesize its final review artifact.",
    phases: [
      {
        title: "Review design",
        detail: "Answer the question and produce any requested design artifacts."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string" },
        projectRoot: { type: "string" },
        requestId: { type: "string" },
        action: {
          type: "string",
          enum: ["process-thread", "finalize"]
        },
        reviewKind: {
          type: "string",
          enum: ["product", "test"]
        },
        thread: {
          anyOf: [{ type: "null" }, designReviewThreadSchema]
        },
        state: { type: "object" }
      },
      required: [
        "prototypeId",
        "projectRoot",
        "requestId",
        "action",
        "reviewKind",
        "thread",
        "state"
      ]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 30,
      timeoutSeconds: 300,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !isObject(args.state) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !String(args.requestId || "").trim() || !["product", "test"].includes(args.reviewKind) || !["process-thread", "finalize"].includes(args.action) || args.action === "process-thread" && !isObject(args.thread)) {
      throw new Error("Design Review factory arguments are invalid.");
    }
    ctx.phase("Review design");
    ctx.log(`Request ${args.requestId}; prototype ${args.prototypeId}.`);
    return ctx.agent(designReviewFactoryPrompt(args), {
      label: args.action === "finalize" ? `Finalize ${args.reviewKind} design` : `Process ${args.reviewKind} design request`,
      schema: designReviewFactoryOutputSchema,
      reasoningEffort: "high"
    });
  }
});
var planningFactory = defineFactory({
  meta: {
    name: PLANNING_FACTORY_NAME,
    description: "Generate or revise a dependency-aware implementation plan optimized for safe parallel execution.",
    phases: [
      {
        title: "Design execution plan",
        detail: "Divide implementation into parallel work items and agent roles."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string" },
        projectRoot: { type: "string" },
        requestId: { type: "string" },
        action: { type: "string", enum: ["generate", "revise"] },
        instruction: { type: "string" },
        maxAgents: { type: "integer", minimum: 1, maximum: 30 },
        state: { type: "object" }
      },
      required: [
        "prototypeId",
        "projectRoot",
        "requestId",
        "action",
        "instruction",
        "maxAgents",
        "state"
      ]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 30,
      timeoutSeconds: 600,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !isObject(args.state) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !String(args.requestId || "").trim() || !["generate", "revise"].includes(args.action) || !Number.isInteger(args.maxAgents)) {
      throw new Error("Execution-planning factory arguments are invalid.");
    }
    ctx.phase("Design execution plan");
    ctx.log(`Request ${args.requestId}; prototype ${args.prototypeId}.`);
    return ctx.agent(planningFactoryPrompt(args), {
      label: args.action === "revise" ? "Revise execution plan" : "Generate execution plan",
      schema: planningFactoryOutputSchema,
      reasoningEffort: "high"
    });
  }
});
var implementationFactory = defineFactory({
  meta: {
    name: IMPLEMENTATION_FACTORY_NAME,
    description: "Execute a finalized implementation plan in dependency waves with live agent observability.",
    phases: [
      {
        title: "Execute work items",
        detail: "Run dependency-ready work items concurrently in the active workspace."
      },
      {
        title: "Summarize implementation",
        detail: "Reconcile work-item outcomes and publish the final result."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string", minLength: 1 },
        projectRoot: { type: "string", minLength: 1 },
        plan: { type: "object" },
        execution: { type: "object" }
      },
      required: ["prototypeId", "projectRoot", "plan", "execution"]
    },
    limits: {
      maxConcurrentSubagents: 30
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !isObject(args.plan) || !Array.isArray(args.plan.workItems) || !Array.isArray(args.plan.waves)) {
      throw new Error("Implementation factory arguments are invalid.");
    }
    const token = { ...executionToken(args.execution || {}), runId: ctx.runId };
    if (executionWorkspace(args.projectRoot) !== token.workspaceRoot) throw new ExecutionSupersededError();
    ctx.signal.throwIfAborted();
    await bindExecutionRun(args.prototypeId, "implementation", token);
    ctx.phase("Execute work items");
    ctx.log(
      `Starting ${args.plan.workItems.length} planned work items for ${args.prototypeId}.`
    );
    for (const wave of args.plan.waves) {
      const boundary = await prepareImplementationWave(
        args.prototypeId,
        wave.index,
        wave.workItemIds,
        token
      );
      if (boundary.stopped) {
        return {
          status: "failed",
          summary: "Implementation was stopped before the next wave."
        };
      }
      if (boundary.runnable.length === 0) continue;
      ctx.log(
        `Wave ${wave.index}: launching ${boundary.runnable.length} agent${boundary.runnable.length === 1 ? "" : "s"}.`
      );
      for (let offset = 0; offset < boundary.runnable.length; offset += boundary.maxConcurrency) {
        const batch = boundary.runnable.slice(
          offset,
          offset + boundary.maxConcurrency
        );
        ctx.signal.throwIfAborted();
        await ctx.parallel(batch.map((item) => async () => {
          await assertExecutionDispatch(args.prototypeId, "implementation", token);
          ctx.signal.throwIfAborted();
          const result = await ctx.step(`implementation:${token.inputRevision}:item:${item.id}`, () => ctx.agent(
            implementationPrompt(
              args,
              item,
              boundary.strategy,
              boundary.completedHandoffs
            ),
            {
              label: `work:${item.id}`,
              schema: implementationAgentOutputSchema,
              reasoningEffort: "high"
            }
          ).then(jsonResult));
          await recordImplementationWaveResults(
            args.prototypeId,
            wave.index,
            [{ itemId: item.id, result }],
            token
          );
          return result;
        }));
      }
    }
    ctx.phase("Summarize implementation");
    const finalState = await loadState(args.prototypeId);
    const implementation = assertCurrentExecution(finalState, "implementation", token);
    const failed = implementation.workItems.filter(
      (item) => ["failed", "blocked", "cancelled"].includes(item.status)
    );
    const incomplete = implementation.workItems.filter(
      (item) => item.status !== "completed"
    );
    if (incomplete.length > 0) {
      ctx.log(
        `${incomplete.length} work item${incomplete.length === 1 ? "" : "s"} remain incomplete.`
      );
      return {
        status: "failed",
        summary: failed.length > 0 ? `${failed.length} work item${failed.length === 1 ? "" : "s"} failed or were blocked.` : `${incomplete.length} work item${incomplete.length === 1 ? "" : "s"} remain incomplete.`
      };
    }
    ctx.log("All planned work items completed.");
    return {
      status: "completed",
      summary: `Completed all ${implementation.workItems.length} planned work items.`
    };
  }
});
var testFactory = defineFactory({
  meta: {
    name: TEST_FACTORY_NAME,
    description: "Execute the finalized integration and interaction test specification in dependency waves.",
    phases: [
      {
        title: "Run test scenarios",
        detail: "Exercise integration boundaries and user interactions."
      },
      {
        title: "Summarize test evidence",
        detail: "Reconcile scenario results and publish test evidence."
      }
    ],
    argsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prototypeId: { type: "string", minLength: 1 },
        projectRoot: { type: "string", minLength: 1 },
        execution: { type: "object" },
        scenarios: {
          type: "array",
          minItems: 1,
          maxItems: 30,
          items: testScenarioSchema
        }
      },
      required: ["prototypeId", "projectRoot", "scenarios", "execution"]
    },
    limits: {
      maxConcurrentSubagents: 4
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !Array.isArray(args.scenarios) || args.scenarios.length === 0) {
      throw new Error("Test factory arguments are invalid.");
    }
    const token = { ...executionToken(args.execution || {}), runId: ctx.runId };
    if (executionWorkspace(args.projectRoot) !== token.workspaceRoot) throw new ExecutionSupersededError();
    ctx.signal.throwIfAborted();
    await bindExecutionRun(args.prototypeId, "testing", token);
    const scenarios = normalizeTestScenarios(args.scenarios);
    const schedule = scheduleTestScenarios(scenarios, 4);
    if (schedule.error || schedule.waves.length === 0) {
      throw new Error(schedule.error || "No test scenarios could be scheduled.");
    }
    ctx.phase("Run test scenarios");
    for (const wave of schedule.waves) {
      const { runnable, dependencyEvidence } = await prepareTestWave(args.prototypeId, wave, token);
      if (runnable.length === 0) continue;
      ctx.signal.throwIfAborted();
      await ctx.parallel(runnable.map((scenario) => async () => {
        await assertExecutionDispatch(args.prototypeId, "testing", token);
        ctx.signal.throwIfAborted();
        const result = await ctx.step(`test:${token.inputRevision}:${token.sourceFingerprint}:scenario:${scenario.id}`, () => ctx.agent(
          testScenarioPrompt(
            args,
            scenario,
            dependencyEvidence
          ),
          {
            label: `test:${scenario.id}`,
            schema: testAgentOutputSchema,
            reasoningEffort: "high"
          }
        ).then(jsonResult));
        await recordTestWaveResults(args.prototypeId, wave, [{ itemId: scenario.id, result }], token);
        return result;
      }));
    }
    ctx.phase("Summarize test evidence");
    const finalState = await loadState(args.prototypeId);
    const testing = assertCurrentExecution(finalState, "testing", token);
    await assertExecutionSources(token);
    const passed = testing.scenarios.length > 0 && testing.scenarios.every((scenario) => scenario.status === "passed");
    return {
      status: passed ? "passed" : "failed",
      summary: passed ? `All ${testing.scenarios.length} integration and interaction scenarios passed.` : `${testing.scenarios.filter(
        (scenario) => scenario.status !== "passed"
      ).length} test scenarios failed or were blocked.`
    };
  }
});
var answerFactory = defineFactory({
  meta: {
    name: ANSWER_FACTORY_NAME,
    description: "Process one Tandem answer in a hidden agent and return the complete next Tandem state.",
    phases: [
      {
        title: "Interpret decision",
        detail: "Apply the selected product intent to the current prototype."
      },
      {
        title: "Return Tandem update",
        detail: "Synthesize the next ledger, artifacts, and question."
      }
    ],
    argsSchema: {
      type: "object",
      properties: {
        prototypeId: { type: "string" },
        projectRoot: { type: "string" },
        requestId: { type: "string" },
        question: {
          type: "object",
          properties: {
            id: { type: "string" },
            text: { type: "string" }
          },
          required: ["id", "text"]
        },
        answer: { type: "string" },
        action: {
          type: "string",
          enum: [
            "add-usage",
            "generate-dag",
            "answer-decision",
            "change-answer",
            "submit-revision",
            "clarify-revision",
            "generate-design-spec",
            "build-prototype"
          ]
        },
        state: { type: "object" }
      },
      required: [
        "prototypeId",
        "projectRoot",
        "requestId",
        "question",
        "answer",
        "action",
        "state"
      ]
    },
    limits: {
      maxConcurrentSubagents: 1,
      maxTotalSubagents: 30,
      timeoutSeconds: 300,
      maxAiCredits: 1024e3
    }
  },
  run: async (ctx) => {
    const args = ctx.args;
    if (!isObject(args) || !isObject(args.question) || !isObject(args.state) || !String(args.prototypeId || "").trim() || !String(args.projectRoot || "").trim() || !String(args.requestId || "").trim() || !String(args.question.id || "").trim() || !String(args.question.text || "").trim() || !String(args.answer || "").trim() || !ANSWER_ACTIONS.has(args.action)) {
      throw new Error("Tandem factory arguments are invalid.");
    }
    ctx.phase("Interpret decision");
    if (!await isPreferredAnswerProvider(PROVIDER_EXTENSION_ID)) {
      throw new Error(
        "This provider no longer owns hidden answer processing."
      );
    }
    ctx.log(
      `Request ${args.requestId}; prototype ${args.prototypeId}; question ${args.question.id}.`
    );
    if (!args.state.generation || !await recordFactoryRunId(
      args.prototypeId,
      args.requestId,
      ctx.runId,
      ANSWER_FACTORY_NAME,
      args.state.generation
    )) {
      throw new Error("This answer job no longer owns the current project inputs. Retry it from Tandem.");
    }
    const result = await ctx.step(
      "process-answer",
      () => ctx.agent(answerFactoryPrompt(args), {
        label: "Process Tandem answer",
        schema: answerFactoryOutputSchema,
        reasoningEffort: "medium"
      })
    );
    if (!isObject(result)) {
      throw new Error("The hidden agent returned an invalid Tandem update.");
    }
    ctx.phase("Return Tandem update");
    ctx.log("Returning the complete Tandem state.");
    return result;
  }
});
session = await joinSession({
  factories: [
    preparationFactory,
    usageSuggestionFactory,
    designReviewFactory,
    planningFactory,
    implementationFactory,
    testFactory,
    answerFactory
  ],
  hooks: {
    onUserPromptSubmitted: async (input) => {
      const prompt = input.prompt.trim();
      const skillAlreadyLoaded = prompt.includes(
        'explicitly invoked the "/tandem" skill'
      );
      if (!/(?:^|\n)\/tandem(?:\s|$)/i.test(prompt) && !skillAlreadyLoaded) {
        return void 0;
      }
      return {
        additionalContext: [
          "The user supplied only the prototype goal, which is expected.",
          skillAlreadyLoaded ? "The Tandem skill is already loaded; do not invoke it again." : "Load the Tandem skill once, then follow it.",
          "Open Tandem immediately with reset true, the goal, and a stable",
          "prototypeId. Do not inspect the workspace or research sources first.",
          "Tandem owns the automatic Preparation stage and will pass its",
          "analysis suggestions into Requirements when preparation finishes.",
          "Do not ask the user to write a more detailed invocation prompt."
        ].join(" ")
      };
    }
  },
  canvases: [
    createCanvas({
      id: CANVAS_ID,
      displayName: "Tandem",
      description: "Capture software intent and lifecycle artifacts through staged workflows, starting with prototyping.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          prototypeId: { type: "string", minLength: 1 },
          reset: { type: "boolean" },
          goal: { type: "string" },
          status: { type: "string" },
          preparation: preparationSchema,
          prototypeApproach: prototypeApproachSchema,
          requirements: requirementsSchema,
          assumed: {
            type: "array",
            items: { type: "string" }
          },
          deferred: {
            type: "array",
            items: { type: "string" }
          }
        }
      },
      actions: [
        {
          name: "update_tandem",
          description: "Update usage intake, the dynamic decision DAG, prototype review evidence, captured artifacts, workflow phase, or embedded preview.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              prototypeId: { type: "string", minLength: 1 },
              reset: { type: "boolean" },
              stage: { type: "string", minLength: 1 },
              goal: { type: "string" },
              phase: {
                type: "string",
                enum: ["discovery", "building", "iterating", "complete"]
              },
              status: { type: "string" },
              preparation: preparationSchema,
              prototypeApproach: prototypeApproachSchema,
              requirements: requirementsSchema,
              prototypeReview: prototypeReviewSchema,
              designReview: designReviewSchema,
              planning: planningSchema,
              question: questionSchema,
              decisionGraph: decisionGraphSchema,
              confirmed: {
                type: "array",
                items: { type: "string" }
              },
              assumed: {
                type: "array",
                items: { type: "string" }
              },
              deferred: {
                type: "array",
                items: { type: "string" }
              },
              artifacts: {
                type: "array",
                maxItems: 30,
                items: artifactSchema
              },
              previewUrl: {
                anyOf: [
                  { type: "string" },
                  { type: "null" }
                ]
              },
              previewStatus: {
                type: "string",
                enum: ["waiting", "starting", "ready", "error"]
              }
            }
          },
          handler: updateTandem
        },
        {
          name: "complete_stage",
          description: "Persist the active stage result and unlock the next stage. Prototype must be finished in Tandem so its draft feature spec is generated first.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              prototypeId: { type: "string", minLength: 1 },
              stageId: {
                type: "string",
                enum: [
                  "prepare",
                  "requirements",
                  "prototype",
                  "design",
                  "plan",
                  "implement",
                  "test"
                ]
              }
            }
          },
          handler: completeStage
        },
        {
          name: "reopen_stage",
          description: "Explicitly reopen a completed stage, preserving snapshots and marking dependent outputs stale. Ask for user confirmation before invoking.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              prototypeId: { type: "string", minLength: 1 },
              stageId: { type: "string", enum: LIFECYCLE_STAGES.map((stage) => stage.id) }
            },
            required: ["stageId"]
          },
          handler: async (ctx) => {
            if (!isObject(ctx.input) || typeof ctx.input["stageId"] !== "string") {
              throw new CanvasError("invalid_stage", "Select a lifecycle stage.");
            }
            return reopenLifecycleStage(await resolvePrototypeId(ctx.instanceId, ctx.input["prototypeId"]), ctx.input["stageId"], ctx.extensionId);
          }
        },
        {
          name: "get_tandem_state",
          description: "Read lifecycle, requirements, prototype revisions, Design Review threads, evidence, artifacts, phase, and preview state.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              prototypeId: { type: "string", minLength: 1 }
            }
          },
          handler: async (ctx) => {
            const input = isObject(ctx.input) ? ctx.input : {};
            const prototypeId = await resolvePrototypeId(
              ctx.instanceId,
              input.prototypeId
            );
            return loadState(prototypeId);
          }
        }
      ],
      open: async (ctx) => {
        const input = isObject(ctx.input) ? ctx.input : {};
        const prototypeId = await resolvePrototypeId(
          ctx.instanceId,
          input.prototypeId
        );
        instancePrototypeIds.set(ctx.instanceId, prototypeId);
        let canSubmitAnswers = await isPreferredAnswerProvider(
          ctx.extensionId
        );
        if (canSubmitAnswers) {
          await persistCurrentPrototypeId(prototypeId);
        }
        let state = await loadState(prototypeId);
        canSubmitAnswers = canSubmitAnswers && (!hasActiveWork(state) || !state.jobOwner || sameOwner(state.jobOwner, { sessionId: session.sessionId, workspaceRoot: WORKSPACE_ROOT }));
        state = await applyCanvasReset(
          state,
          input,
          `${ctx.sessionId}:${ctx.instanceId}`,
          isCanvasRehydration(ctx),
          canSubmitAnswers
        );
        if (canSubmitAnswers) state = await markReloadComplete(state, ctx.extensionId);
        state = await ensureDefaultProductDesignReview(
          state,
          canSubmitAnswers
        );
        recoverPreparationFactory(state, canSubmitAnswers);
        recoverAnswerFactory(state, canSubmitAnswers);
        recoverSuggestionFactory(state, canSubmitAnswers);
        recoverPrototypeCompletion(state, canSubmitAnswers);
        recoverDesignReviewFactory(state, canSubmitAnswers);
        recoverPlanningFactory(state, canSubmitAnswers);
        recoverImplementationFactory(state, canSubmitAnswers);
        recoverTestFactory(state, canSubmitAnswers);
        if (canSubmitAnswers && typeof input.goal === "string" && input.goal.trim() && !state.goal) {
          state = await withAnswerClaim(prototypeId, async () => {
            const current = await loadState(prototypeId);
            if (current.goal || hasActiveWork(current)) {
              return current;
            }
            const next = {
              ...current,
              goal: input.goal.trim().slice(0, 4e3),
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            };
            await persistState(next);
            publishState(prototypeId);
            return next;
          });
        }
        let entry = servers.get(ctx.instanceId);
        if (!entry) {
          entry = await startServer(
            ctx.instanceId,
            prototypeId,
            ctx.extensionId,
            canSubmitAnswers
          );
          servers.set(ctx.instanceId, entry);
        } else {
          entry.prototypeId = prototypeId;
          entry.extensionId = ctx.extensionId;
          entry.canSubmitAnswers = canSubmitAnswers;
        }
        state = state.lifecycle.currentStage === "prepare" ? await ensurePreparationStarted(
          state,
          canSubmitAnswers
        ) : await ensureUsageSuggestionsStarted(
          state,
          canSubmitAnswers
        );
        return {
          title: "Tandem",
          status: state.status,
          url: entry.url
        };
      },
      onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) return;
        servers.delete(ctx.instanceId);
        instancePrototypeIds.delete(ctx.instanceId);
        clearInterval(entry.heartbeat);
        for (const client of entry.clients) client.end();
        await new Promise((resolve3) => entry.server.close(resolve3));
      }
    })
  ]
});
