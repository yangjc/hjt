/**
 * Debug & Build Tools for Halberd-JS Template Engine
 * Released under the MIT license
 * @author	YJC
 * @version	0.1
 * @since	2013-07-19
 */

(function(factory){ // for compatibility
  if (typeof require == 'function' && typeof exports == 'object' && typeof module == 'object') {
    factory(require, exports, module); // Node.js
  } else if (typeof define == 'function') {
    define(factory); // AMD|CMD
  } else {
    var n, e = {}, m = { exports:e };
    factory(function(){}, e, m); // front-end native
    (n = (e = m.exports)._name) && (window[n] = e);
  }
})(function(require, exports, module){
  var hjt = require('hjt') || window.hjt,
    parse_js = require('parse_js') || window.parse_js;

  function each(object, callback){
    for (var i in object) {
      callback(object[i], i);
    }
  }

  // 获取行号
  function get_line_num(code, end) {
    return code.substr(0, end).split('\n').length - 1;
  }

  // 分析模板源码是否有语法错误
  function parse_template(code, tag_open, tag_close) {
    var i = 0, l = code.length, l_open = tag_open.length, l_close = tag_close.length,
      opened = 0, c_opened = 0, i_open, i_c_open, tag_c_open = tag_open + '*', tag_c_close = '*' + tag_close;
    for (; i < l; i++) {
      if (code.substr(i, l_open + 1) === tag_c_open) {
        if (opened) {
          return { error:'logical statement can not nest comment', line:get_line_num(code, i) };
        }
        if (c_opened) {
          return { error:'comment can not be nested', line:get_line_num(code, i) };
        }
        c_opened ++;
        i_c_open = i;
        i += l_open;
      } else if (c_opened && code.substr(i, l_close + 1) === tag_c_close) {
        c_opened --;
        i += l_close;
      } else if (c_opened === 0) {
        if (code.substr(i, l_open) === tag_open) {
          if (opened) {
            return { error:'logical statement can not be nested', line:get_line_num(code, i) };
          }
          opened ++;
          i_open = i;
          i += l_open - 1;
        } else if (code.substr(i, l_close) === tag_close) {
          if (opened === 0) {
            return { error:'redundant close tag', line:get_line_num(code, i) };
          }
          opened --;
          i += l_close - 1;
        }
      }
    }
    if (c_opened > 0) {
      return { error:'unclosed comment tag', line:get_line_num(code, i_c_open) };
    }
    if (opened > 0) {
      return { error:'unclosed open tag', line:get_line_num(code, i_open) };
    }
    return null;
  }

  var node_require = require, m_fs, pub_fs, m_path;

  function Node_build(config){
    if ( ! config || typeof config !== 'object') {
      return;
    }

    if ( ! m_fs) {
      m_fs = node_require('fs');
      pub_fs = node_require('pub/fs');
      m_path = node_require('path');
    }

    if ( ! config.path || ! config.build_path || ! pub_fs.is_dir_sync(config.path)) {
      return;
    }
    pub_fs.mkdir_sync(config.build_path);
    if ( ! pub_fs.is_dir_sync(config.build_path)) {
      return;
    }

    this._path = this.format_path(config.path);
    this._build_path = this.format_path(config.build_path);
    this._charset = config.charset || 'utf-8';
    this._tag_open = config.tag_open || '{{';
    this._tag_close = config.tag_close || '}}';
    this._mode = config.mode || 'node';

    // types : [ as_new_engine, debug ]
    this.types = {
      0: [ 1, 0 ],
      debug: [ 1, 1 ]
    };
    if (this._mode !== 'node') {
      this.types["o"] = [ 0, 0 ];
      this.types["o-debug"] = [ 0, 1 ];
    }
    this.hjt = {};
    this._hjt_count = 0;
    for (var i in this.types) {
      this.hjt[i] = new hjt.Hjt({
        tag_open: this._tag_open,
        tag_close: this._tag_close,
        charset: this._charset,
        as_new_engine: this.types[i][0],
        debug: this.types[i][1]
      });
      this._hjt_count ++;
    }
  }

  Node_build.prototype = {
    format_path: function(path){
      return path.replace(/[\\/]+$/, '').replace(/[\\/]+/g, m_path.sep) + m_path.sep;
    },
    build_target: function(file, type){
      return this._build_path + file.replace(/[\\/]/g, '%') + (type == 0 ? '' : '~' + type) + '.js';
    },
    exports_fn: function(fn, is_debug){
      fn = 'exports.view=' +
        fn.toString().replace(/^\s*function\b[^{]*/, 'function(o'+(is_debug?',_':'')+')');
      if (this._mode === 'node') {
        return fn + ';';
      }
      return 'define(function(require,exports,module){'+fn+'});';
    },
    build: function(file, callback){
      var _this = this;
      m_fs.readFile(this._path + file, {encoding:this._charset}, function(err, code){
        if (err) {
          callback([ 'read file error', err ]);
          return;
        }

        code = code.replace(/\r\n?|[\n\u2028\u2029]/g, "\n").replace(/^\uFEFF/, ''); // 替换换行符
        err = parse_template(code, _this._tag_open, _this._tag_close);
        if (err) {
          callback([ 'parse template error', err, code.split('\n')[err.line] ]);
          return;
        }
        // 预编译
        var i_debug = _this.hjt.debug.compile(code, file);
        err = _this.hjt.debug.fns(i_debug, 0).compile_err;
        if (typeof err === 'number') {
          err = _this.hjt.debug.logs(err, 0);
          callback([ 'compile error', err,
            err[1].line >= 0 ? code.split('\n')[err[1].line] : '?' ]);
          return;
        }

        err = [ 'write file error', [] ];
        var count = _this._hjt_count;
        each(_this.hjt, function(t, i){
          t = _this.hjt[i];
          var index = i === 'debug' ? i_debug : t.compile(code, file);
          m_fs.writeFile(
            _this.build_target(file, i),
            _this.exports_fn(t.fns(index, 0), t._debug),
            {encoding:_this._charset},
            function(e){
              count --;
              if (e) {
                err[1].push([file, i, e]);
              }
              if (count > 0) {
                return;
              }
              callback(err[1].length ? err : null);
            }
          );
        });
      });
    },
    build_all: function(callback){
      var _this = this, _err = [], _count = 0, count = 0;
      pub_fs.rdir(_this._path.substr(0, _this._path.length - 1), function(err, result){
      }, function(path, file, stat){
        if ( ! stat.isFile()) {
          return;
        }
        var _file = (path + m_path.sep + file).replace(_this._path, '');
        _count ++;
        _this.build(_file, function(err){
          _count --;
          count ++;
          if (err) {
            _err.push([ _file, err ]);
          }
          if (_count > 0) {
            return;
          }
          callback(_err.length ? _err : null, count);
        });
      }, 1);
    }
  };

  hjt.apply_parser(function(code){
    try {
      parse_js.parse(code);
      return -1;
    } catch(e) {
      return e.pos;
    }
  }, parse_template);

  for (var i in hjt) {
    exports[i] = hjt[i];
  }

  exports.Node_build = Node_build;
});