/**
 * Halberd-JS Template Engine
 * Released under the MIT license
 * @author	YJC <yangjiecong@live.com>
 * @version	0.7
 * @since	2013-01-20 .. 2013-07-01
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
  if (require.toString().replace(/\s+/g, "") === 'function(){}') {
    require = function(){ throw new Error('require undefined'); };
  }

  var KEYWORDS = [
    // 关键字
    'break','case','catch','continue','debugger','default','delete','do','else','false',
    'finally','for','function','if','in','instanceof','new','null','return','switch','this',
    'throw','true','try','typeof','var','void','while','with',
    // 保留字
    'abstract','boolean','byte','char','class','const','double','enum','export','extends',
    'final','float','goto','implements','import','int','interface','long','native',
    'package','private','protected','public','short','static','super','synchronized',
    'throws','transient','volatile',
    // ECMA 5 - use strict
    'arguments','let','yield','undefined'
  ];

  var GLOBAL_VARS = [
    // 内置对象
    'Array','Boolean','Date','Error','Function','Math','Number','Object','RegExp','String',
    // 内置函数
    'escape','isFinite','isNaN','parseFloat','parseInt','unescape',
    'encodeURI','encodeURIComponent','decodeURI','decodeURIComponent'
  ];

  // 异步获取模板函数的集合
  var async_cache = {};

  // 判断是否支持新引擎
  // 新引擎：字符串拼接使用 += 效率更高
  // 旧引擎：字符串拼接使用 Array.join 效率更高
  // 例外：IE8下，存在 ''.trim 但使用 Array.join 拼接效率更高
  var _new_engine = !!(''.trim);

  var trim, undefined;
  // 去除头尾空白字符
  if (_new_engine) {
    trim = function(str){ return str.trim(); };
  } else {
    trim = function(str){ return str.replace(/^\s*/, '').replace(/\s*$/, ''); };
  }

  // 编译用的代码片段
  var compile_block = [
    { // 旧引擎
      ctor: '[]',
      append: '$.push(',
      a_end: ')',
      end: '.join("")'
    },
    { // 新引擎
      ctor: '""',
      append: '$+=',
      a_end: '',
      end: ''
    }
  ];

  // 复制一个对象
  function clone(object){
    function F(){}
    F.prototype = object;
    return new F;
  }

  // 转义双引号/回车/换行
  function str_escape(str) {
    return str.replace(/(["\\])/g, '\\$1').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  }

  /**
   * 将语句内的读取变量/对象值的语句转换为通过指定函数读取的语句
   * 前提：语句是符合语法的
   */
  var convert_vars = (function(){
    var reg_name_start = /[$a-zA-Z_]/, _reg_end = /[^$\w\s]/, reg_name = /[$\w]/, reg_name_end = /[^$\w]/,
      reg_not_blank = /\S/, reg_blank = /\s/, sep_k = '\\b|^',
      reg_k = new RegExp('^' + KEYWORDS.join(sep_k) + sep_k + GLOBAL_VARS.join(sep_k) + '\\b'),
      reg_prev = /^([^$\w]|)$/, reg_rptor = /[~!%^&*(+={}\[|:;<>?/-]/;

    // 抽取变量读取语句的变量名和属性名
    // 例如 a.b[c]["d"][ 5 > 3 ? 'e' : f ] 抽取 'a','b',c,'d',5 > 3 ? 'e' : f
    function get_attrs(str, index) {
      var i = index, length = str.length, c = '', _c = '', attrs = [], dot = true, start = -1, end = -1,
        bracket_open = 0, delimiter = '', r_punctuator = '', back_slant = false, r_open_bracket = 0;
      for (; i <= length; i++) {
        c = str.charAt(i);
        _c = str.charAt(i - 1); // 前一个字符

        // 区分除法运算符和正则表达式的左定界符
        if (reg_rptor.test(_c)) {
          r_punctuator = _c;
        } else if (reg_not_blank.test(_c)) {
          r_punctuator = '';
        }
        // 标记反斜杠是否单数（连续）出现
        if (c === '\\') {
          back_slant = (_c === '\\' && ! back_slant);
        }
        // 标记正则表达式内，非匹配的左中括号数目
        if (delimiter === '/') {
          if (_c !== '\\' || (_c === '\\' && back_slant)) {
            if (c === '[') {
              r_open_bracket ++;
            } else if (c === ']') {
              r_open_bracket --;
            }
          }
        }

        // 字符串/正则表达式定界符
        if (c === '"' || c === "'" || c === '/') {
          // 定界符结束：考虑非转义和并非在正则表达式中括号（字符集合符）内部的情况
          if (delimiter === c && (_c !== '\\' || (_c === '\\' && back_slant)) && (c !== '/' || c === '/' && r_open_bracket === 0)) {
            delimiter = '';
          }
          // 定界符开始：排除除法运算符
          else if (delimiter === '' && (c !== '/' || (c === '/' && (r_punctuator || i === 0)))) {
            delimiter = c;
          }
        }
        // 点号开始的属性名
        else if (dot) {
          if ((start === -1 && reg_blank.test(c)) || (start !== -1 && reg_name.test(c))) {
            continue;
          }
          if (start === -1 && reg_name_start.test(c)) {
            start = i;
          } else if (start !== -1 && (reg_name_end.test(c) || c === '')) {
            attrs.push('"' + str.substring(start, i) + '"');
            start = -1;
            end = i;
            dot = c === '.';
          } else {
            break;
          }
        }
        // 非字符串/正则表达式内部
        if (delimiter === '') {
          if (bracket_open === 0 && c === '.') {
            dot = true;
          } else if (c === '[') {
            if (bracket_open === 0) {
              start = i + 1;
            }
            bracket_open ++;
          } else if (c === ']') {
            bracket_open --;
            if (bracket_open === 0) {
              attrs.push(trim(str.substring(start, i)));
              start = -1;
              end = i + 1;
            }
          } else if (start === -1 && bracket_open === 0 && reg_not_blank.test(c)) {
            break;
          }
        }
      }

      return { attrs: attrs, length: end - index };
    }

    function convert_vars(str, method, object_name) {
      var i, c, _c = '', l = str.length, re = [], last = 0,
        delimiter = '', r_punctuator = '', dot = false, started = false, back_slant = false, r_open_bracket = 0;
      for (i = 0; i < l; i++) {
        c = str.charAt(i); // 当前字符
        _c = str.charAt(i - 1); // 前一个字符
        // 非 $ 数字 字母 下划线 空白符
        if (_reg_end.test(c)) {
          started = dot = false;
        }
        // 区分除法运算符和正则表达式的左定界符
        if (reg_rptor.test(_c)) {
          r_punctuator = _c;
        } else if (reg_not_blank.test(_c)) {
          r_punctuator = '';
        }
        // 标记反斜杠是否单数（连续）出现
        if (c === '\\') {
          back_slant = (_c === '\\' && ! back_slant);
        }
        // 标记正则表达式内，非匹配的左中括号数目
        if (delimiter === '/') {
          if (_c !== '\\' || (_c === '\\' && back_slant)) {
            if (c === '[') {
              r_open_bracket ++;
            } else if (c === ']') {
              r_open_bracket --;
            }
          }
        }

        // 标记点号出现（此时点号不在字符串/正则表达式内部）
        if (c === '.' && delimiter === '') {
          dot = true;
        }
        // 字符串/正则表达式定界符
        else if (c === '"' || c === "'" || c === '/') {
          // 定界符结束：考虑非转义和并非在正则表达式中括号（字符集合符）内部的情况
          if (delimiter === c && (_c !== '\\' || (_c === '\\' && back_slant)) && (c !== '/' || c === '/' && r_open_bracket === 0)) {
            delimiter = '';
            dot = true;
          }
          // 定界符开始：排除除法运算符
          else if (delimiter === '' && (c !== '/' || (c === '/' && (r_punctuator || i === 0)))) {
            delimiter = c;
          }
        }
        // 判断是否标识符开始
        else if (reg_name_start.test(c) && delimiter === '' && ! dot && ! started && reg_prev.test(_c)) {
          // 排除关键字/保留字/内置全局变量
          if (reg_k.test(str.substr(i))) {
            i ++;
          } else {
            re.push(i);
            last = i;
            started = true;
          }
        }
      }

      l = re.length;
      // 取得语句内所有变量第一个字符所在的位置索引
      if (l === 0) return str;

      var index, var_attrs;
      for (i = l - 1; i >= 0; i--) {
        index = re[i];
        var_attrs = get_attrs(str, index);
        str = str.substr(0, index) +
          // 读取属性值的语句
          method + '(' + object_name + ',' + var_attrs.attrs.join(',') + ')' +
          str.substr(index + var_attrs.length);
      }

      return str;
    }

    convert_vars.get_attrs = get_attrs;

    return convert_vars;
  })();

  /**
   * 给代码打上行号
   * @param {String} source
   */
  function add_line_num(source) {
    var line = 1;
    return ' [1] \t' + source.replace(/\n/g, function(){ return '\n [' + (++line) + '] \t' });
  }

  /**
   * 获取对象的指定属性值
   * @param {Object|Function} object
   * @returns {*}
   */
  function get_var(object) {
    var o;
    switch (arguments.length) {
      case 2:
        return object[arguments[1]] === 0 ? 0 : object[arguments[1]] || '';
//          (object.$debug ? '' + object[arguments[1]] : '');
      case 3:
        o = object[arguments[1]] || '';
        if (typeof o === 'object' || typeof o === 'function') {
          return o[arguments[2]] === 0 ? 0 : o[arguments[2]] || '';
//            (object.$debug ? '' + o[arguments[2]] : '');
        }
        return '';
      case 4:
        o = object[arguments[1]] || '';
        if (typeof o === 'object' || typeof o === 'function') {
          return get_var(o, arguments[2], arguments[3]);
        }
        return '';
      case 1:
        return '';
    }

    o = object;
    for (var i = 1, l = arguments.length, last = l - 1; i < l; i ++) {
      if (arguments[i] in o) {
        o = o[arguments[i]];
        if (i === last) {
          return o === 0 ? 0 : o || '';//(object.$debug ? '' + o : '');
        }
        if (typeof o !== 'object' && typeof o !== 'function') {
          return '';
        }
      } else {
        return '';
      }
    }

    return '';
  }

  // 转换模板注释
  function comment_convert(code, _tag_open, _tag_close) {
    var comment = [];
    if (code.indexOf(_tag_open+'*') === -1) return { code:code, comment:comment };

    var open_length = _tag_open.length + 1, tag_length = open_length + _tag_close.length + 1;
    code = code.replace(new RegExp(_tag_open+'\\*(?:.|[\\r\\n])*?\\*'+_tag_close, 'g'), function(str){
      var length = str.length;
      if (length === tag_length) return '';
      var index = comment.length;
      comment.push(str.substr(open_length, length - tag_length));
      return _tag_open + '$_c' + index + _tag_close;
    });
    return { code:code, comment:comment };
  }

  /**
   * 编译模板字符串为函数体字符串
   * @param tpl 模板源码，假设换行符为 LF (\n)
   * @param _tag_open 代码块开始标记
   * @param _tag_close 代码块结束标记
   * @param _block 新旧引擎下使用代码块
   * @param _debug 是否启用调试
   * @return {String|Object} 函数体|出错信息
   */
  function compile(tpl, _tag_open, _tag_close, _block, _debug) {
    var _source = comment_convert(tpl, _tag_open, _tag_close),
      l = _source.comment.length, i, j, i_name, v_name, line = 0, err,
    // a:获取变量值;o:数据对象;t:获取子模板;l:模板行数;$:输出;f:arguments.callee
      constructor = 'var a=o.$value,t=o.$view,l,$='+_block.ctor+';';
    if ( ! _new_engine) constructor = [ constructor ];
    if (l) {
      for (i = 0; i < l; i++) {
        j = 'o.$comment' + i + '=' + 'o.$_c' + i + '="' +
          str_escape(_source.comment[i]) + '";';
        if (_new_engine) constructor += j;
        else constructor.push(j);
      }
    }
    var source = _source.code;
    var s0 = source.split(_tag_open), s1, code, keyword, statement, html,
      _i = 0, _count, _start, _step;
    l = s0.length;
    for (i = 0; i < l; i ++) {
      if (i === 0) {
        code = '';
        html = s0[i];
      } else {
        s1 = s0[i].split(_tag_close);
        code = trim(s1[0]);
        html = s1[1];
      }
      if (_debug) {
        if (/^\$_c\d+$/.test(code)) {
          line += _source.comment[code.substr(3)].split('\n').length - 1;
        }
        line += (code + html).split('\n').length - 1;
      }
      if (code && code.charAt(0) !== '/') {
        j = code.match(/\s/);
        if (j) {
          j = j.index;
          keyword = code.substr(0, j);
          statement = trim(code.substr(j + 1));
        } else {
          keyword = code;
          statement = '';
        }
        switch (keyword) {
          case 'for':
            statement = statement.split(/\s*\|\s*/);
            if (statement[1]) {
              i_name = 'o.' + statement[1];
            } else {
              i_name = 'o.$i';
            }
            statement = statement[0].split(/\s*,\s*/);
            _count = convert_vars(statement[0], 'a', 'o');
            _start = convert_vars(statement[1] || '0', 'a', 'o');
            _step = convert_vars(statement[2] || '1', 'a', 'o');
            code = 'var l'+_i+'=parseInt('+_count+')*'+_step+'+'+_start +
              ';for(var i'+_i+'='+_start+';i'+_i+'<l'+_i+';i'+_i+'+='+_step+'){'+i_name+'=i'+_i+';';
            _i ++;
            break;
          case 'each':
            statement = statement.split(/\s*\|\s*/);
            if (statement[1]) {
              statement[1] = statement[1].split(/\s*:\s*/);
              if (statement[1][1]) {
                i_name = 'o.'+statement[1][0];
                v_name = 'o.'+statement[1][1];
              } else {
                i_name = 'o.$i';
                v_name = 'o.'+statement[1][0];
              }
            } else {
              i_name = 'o.$i';
              v_name = 'o.$v';
            }
            code = 'var x'+_i+'='+convert_vars(statement[0], 'a', 'o')+
              ';if(x'+_i+'&&(typeof x'+_i+'==="object"||typeof x'+_i+'==="function"))'+
              'for(var i'+_i+' in x'+_i+'){'+i_name+'=i'+_i+';'+v_name+'=x'+_i+'[i'+_i+'];';
            _i ++;
            break;
          case 'if':
            code = 'if(' + convert_vars(trim(statement), 'a', 'o') + '){';
            break;
          case 'else':
            if (statement.indexOf('if') === 0) {
              code = '}else if(' + convert_vars(trim(statement.substr(2)), 'a', 'o') + '){';
            } else {
              code = '}else{';
            }
            break;
          case 'var':
            if (statement.charAt(0) === '$') {
              return { error:'Assigned variables can not begin with "$"', line:line-1 };
            }
            code = 'o.' + statement + ';';
            break;
          case 'include':
            statement = statement.split(/\s*,\s*/);
            code = _block.append+'t(' + convert_vars(statement[0], 'a', 'o') + ',' +
              (statement[1] ? convert_vars(statement[1], 'a', 'o') : 'o') + ')'+_block.a_end+';';
            break;
          default:
            code = _block.append + convert_vars(code, 'a', 'o') + _block.a_end + ';';
        }
      } else if (i) {
        code = '}';
      }
      if (html) {
        html = _block.append + '"' + str_escape(html) + '"'+_block.a_end+';';
      }
      if (_new_engine) {
        constructor += (code + html + (_debug ? 'l=' + line + ';' : ''));
      } else {
        constructor.push(code + html + (_debug ? 'l=' + line + ';' : ''));
      }
    }
    if (_new_engine) return constructor + 'return $' + _block.end;
    constructor.push('return $' + _block.end);
    return constructor.join('');
  }

  /**
   * 构造函数
   * @param {Object} config 配置
   * @constructor
   */
  function Hjt(config){
    if (typeof config !== 'object') config = {};

    this._debug = config.debug || 0; // 0:屏蔽所有错误信息; 1:显示错误信息且保存到 this._log
    this._tag_open = config.tag_open || '{{'; // 逻辑语法开始标签
    this._tag_close = config.tag_close || '}}'; // 逻辑语法结束标签
    this._path = config.path || ''; // 模板路径
    this._build_path = config.build_path || ''; // 编译后的模板路径，必须以系统分隔符/模块标识分隔符结尾
    this._charset = config.charset || 'utf-8'; // 字符编码
    this._compile_err_re = config.compile_error_return; // 编译出错时的返回 (String|Function)

    // 强制指定是否使用新引擎
    if ('as_new_engine' in config) {
      this._as_new_engine = config.as_new_engine;
    } else {
      this._as_new_engine = _new_engine;
    }
    this._compile_block = compile_block[this._as_new_engine ? 1 : 0];

    this._fn = []; // 编译后的函数缓存
    this._index = {}; // 同步调用的 source:fn_index 对应关系
    this._i_async = {}; // 异步调用的 file:fn_index 对应关系
    this._ready = {}; // 异步 file 是否准备就绪
    if (this._debug) {
      this._log = []; // 错误信息：[ [错误类型, 调试信息, Error对象] ,... ]
    }

    var _this = this;
    this._view = function(source, data){
      return _this.view(source, data);
    };
  }

  Hjt.prototype = {
    /**
     * 处理数据对象，使其符合渲染要求
     * @param {Object} data
     * @returns {Object}
     */
    get_data: function(data){
      if (typeof data === 'object' && data) {
        data = clone(data);
      } else {
        data = {};
      }
      if (this._helper) {
        for (var i in this._helper) {
          data[i] = this._helper[i];
        }
      }

      data.$value = get_var; // 获取变量值
      data.$view = this._view; // 获取子模板
//      data.$debug = this._debug; // 是否启用调整
      data.$tag0 = this._tag_open; // 逻辑语法开始标签
      data.$tag1 = this._tag_close; // 逻辑语法结束标签

      return data;
    },
    /**
     * 编译模板
     * @param {String|HTMLElement} code 模板源码|存储模板源码的HTML节点
     * @param {String} id 模板标识（可选）
     * @returns {number} 编译后的渲染函数的缓存索引
     */
    compile: function(code, id){
      if (typeof code === 'object' && code.innerHTML) {
        code = trim(code.innerHTML);
      }
      var fn, fn_index = this._fn.length, tpl_err;

      if (this._debug) {
        code = code.replace(/\r\n?|[\n\u2028\u2029]/g, "\n").replace(/^\uFEFF/, ''); // 替换换行符
        tpl_err = parse_template(code, this._tag_open, this._tag_close); // 检查模板语法错误
      }

      if (tpl_err) {
        fn = this._compile_err(fn_index, id, tpl_err.error, code, tpl_err.line);
      } else {
        var fn_body = compile(code, this._tag_open, this._tag_close, this._compile_block, this._debug);

        if (typeof fn_body === 'object') {
          fn = this._compile_err(fn_index, id, fn_body.error, code, fn_body.line);
        } else {

        try {
          if (this._debug) {
            // 调试模式源码：捕获错误时输出错误信息
            fn = new Function('o', '_',
              'try{' + fn_body + '}catch(e){' +
                'var f=arguments.callee;_.push(["runtime",{index:f.index,id:f.id,line:l,data:o},e]);'+
                'return $' + this._compile_block.end +
                '+"[ErrRUNTIME] fn : "+f.index+" , id : "+f.id+" , log : "+(_.length-1)+" , ' +
                'line "+(l+1)+" : "+f.source.split("\\n")[l]+"[/ErrRUNTIME]"}');
            fn.source = code;
          } else {
            // 线上模式：屏蔽一切错误
            fn = new Function('o', 'try{' + fn_body + '}catch(e){return $'+this._compile_block.end+'}');
          }
        } catch(e) {
          // 编译出错
          var _line;
          if (this._debug) {
            var fn_code = '(function(){'+fn_body+'})();', pos = parse_syntax(fn_code); // 调用语法分析器

            if (typeof pos === 'number') {
              if (pos === -1) {
                _line = -1;
              } else {
                _line = 0;
                var reg_line_num = /(?:^|;)l=(\d+);$/, m, c, i;
                for (i = pos; i >= 0; i --) {
                  c = fn_code.substr(0, i);
                  m = reg_line_num.exec(c);
                  if (m) {
                    _line = parseInt(m[1]);
                    break;
                  }
                }
              }
            }
          }

          fn = this._compile_err(fn_index, id, e, code, _line);
        }

        }
      }

      fn.index = fn_index;
      fn.id = id;
      this._fn.push(fn);

      return fn_index;
    },
    /**
     * 同步方式载入模板并渲染
     * @param {String|Number} source 模板源
     *  传入数字时，从缓存里取渲染函数
     *  传入字符串时，如果以 # 开头，则取页面上 #id 对应的节点的 innerHTML 作为模板源码（仅能用于前端）
     *  非 # 开头的字符串，则调用 require(source) 载入模板
     *  约定：require(source) 的返回值为如下结构的对象：{ exports:{ view:Function } }
     *  exports.view 为编译好的渲染函数
     * @param {Object} data 数据对象
     * @returns {String} 渲染后的结果或者出错信息
     */
    view: function(source, data){
      data = this.get_data(data);

      switch (typeof source) {
        case 'string':
          if (source in this._index) {
            return this._fn[this._index[source]](data, this._log);
          }

          if (source.charAt(0) === '#') {
            var node = document.getElementById(source.substr(1));
            if (node && node.innerHTML) {
              var index = this.compile(trim(node.innerHTML), source);
              this._index[source] = index;
              return this._fn[index](data, this._log);
            }
          } else {
            try {
              var fn = require(this._build_path + source).view;
            } catch(e) {
              if (this._debug) {
                this._log.push(['view', source, e]);
              }
            }

            if (typeof fn !== 'function') {
              return this._debug ? '[Hjt] view : require(' + source + ') error' : '';
            }

            this._index[source] = this._fn.length;
            this._fn.push(fn);

            return fn(data, this._log);
          }
          break;
        case 'number':
          if (this._fn[source]) {
            return this._fn[source](data, this._log);
          }
          return this._debug ? '[Hjt] view : uncached source ' + source : '';
      }

      return this._debug ? '[Hjt] view : unexpected source ' + source : '';
    },
    /**
     * 异步载入模板并渲染
     * @param async {String|Function} 异步加载函数（标识）
     * @param file 模板标识
     * @param data 数据对象
     * @param callback 回调函数，传参：出错信息，渲染后的结果
     */
    view_async: function(async, file, data, callback){
      if (typeof async === 'string' && async_cache[async]) {
        async = async_cache[async];
      }
      view_async(async, file, data, callback, this);
    },
    /**
     * 打印日志，方便调试
     * 考虑 ie6/7 的调试，通过 console.log 方式输出字符串
     * 如果希望输出数据对象的某个值，从第二个参数开始传入属性名
     * 如果传入的第二个参数不是字符串，则不输出到控制台
     * @param index 索引，不传入此参数则返回错误日志的数组长度
     */
    logs: function(index){
      if (index === undefined) {
        return this._log ? this._log.length : -1;
      }

      if ( ! this._debug) {
        return 'debug off';
      }
      var e = this._log[index], i;
      if ( ! e) {
        return 'unknown log['+index+']';
      }
      if (typeof arguments[1] === 'string') { // 打印 data 指定值
        var attrs = Array.prototype.slice.call(arguments, 1),
          x = 'data(' + attrs.join(',') + ') : ';
        if (e[1] && typeof e[1] === 'object' && e[1].data) {
          return x + get_var.apply(null, [ e[1].data ].concat(attrs));
        } else {
          return x + 'empty';
        }
      }
      if (arguments.length === 1 && typeof console !== 'undefined') { // 打印 _log 指定项
        var _e = e[2];
        if (typeof _e === 'object') {
          _e = (_e.name ? _e.name + " : " : "") + (_e.message || _e) +
            (_e.number ? " (number:" + _e.number + ") " : "")+
            (_e.stack ? "\n[stack] " + _e.stack : "");
        }
        console.log('\n [ErrType] ' + e[0] + '\n [Error] \n\n' + _e + '\n ');
        if (e[1] && typeof e[1] === 'object') {
          for (i in e[1]) {
            console.log('\n [' + i + '] \n\n' +
              ( i === 'source' ? add_line_num(e[1][i]) : e[1][i] ) + '\n');
          }
        } else {
          console.log('\n [Info] \n\n');
          console.log(e[1]);
        }
      }
      return e;
    },
    /**
     * 打印编译后的渲染函数的信息
     * @param index 索引，不传入时返回已缓存的渲染函数的个数
     *  传入第二个参数时不输出到控制台
     */
    fns: function(index){
      if (index === undefined) {
        return this._fn.length;
      }
      var fn = this._fn[index];
      if ( ! fn) {
        return 'unceched fn['+index+']';
      }

      if (arguments.length === 0 && typeof console !== 'undefined') {
        if (fn.source) {
          console.log('\n [template source] \n\n' + add_line_num(fn.source) + '\n ');
        }
        console.log('\n [compiled code] \n\n' + (fn.hasOwnProperty('compile_err') ? 'compile error' :
          fn.toString().replace(/([;{}])/g, '$1\n')) + '\n ');
      }
      return fn;
    },
    /**
     * 追加helper
     * @param {Object} helper
     */
    helper: function(helper){
      if (typeof helper === 'object') {
        if ( ! this._helper) {
          this._helper = {};
        }
        for (var i in helper) {
          this._helper[i] = helper[i];
        }
      }
    },
    /**
     * 清除helper
     */
    clear_helper: function(){
      this._helper = null;
    },

    /**
     * 编译出错时调用，返回此时的渲染函数
     */
    _compile_err: function(fn_index, id, err, source, line){
      var re = '';
      if ( ! this._debug) {
        if (typeof this._compile_err_re === 'function') {
          re = this._compile_err_re.apply(this, arguments);
        } else if (this._compile_err_re) {
          re = this._compile_err_re;
        }
        return function(){ return re };
      }

      re = '[ErrCOMPILE] fn : ' + fn_index + ' , id : ' + id +
        ' , log ' + this._log.length + ' , line : ' +
        (line >= 0 ? (line+1) + ' : ' + source.split('\n')[line] : line) + ' [/ErrCOMPILE]';
      var fn = function(){ return re };
      fn.source = source;
      fn.compile_err = this._log.length;
      this._log.push(['compile', { index:fn_index, id:id, line:line }, err]);
      return fn;
    }
  };

  /**
   * 异步载入子模板并渲染
   * 模板标识相同的模板，载入之后会被缓存
   */
  function view_async_include(async, parent, _f, _d, callback, _this, _sig){
    if (_this._ready[_f]) {
      if (_this._i_async[_f] === undefined) {
        return _this._debug ? '[Hjt] include('+_f+') error' : '';
      }
      return _this._fn[_this._i_async[_f]](_d, _this._log);
    }
    if (_f in _this._i_async) {
      return '';
    }

    _sig.included[parent] ++;
    _sig.included_all ++;
    view_async(async, _f, _d, function(err, result){
      _sig.included[parent] --;
      _sig.included_all --;

      if (err) {
        _sig.err.push(['include', _f, err]);
      }

      _this._ready[_f] = 1;

      if (_sig.included_all === 0) {
        callback(_sig.err.length ? _sig.err : null, _this._fn[_sig.main](_sig.data, _this._log));
      } else if (_sig.included[parent] === 0) {
        callback();
      }
    }, _this, _sig);

    return '';
  }

  /**
   * 异步载入模板并渲染
   * 模板标识相同的模板，载入之后会被缓存
   * @param async 异步载入模板的函数，传参：模板标识，上下文对象，回调函数
   *  回调函数传参：出错信息，模板源码
   * @param {String} file 模板标识（文件名/模块标识）
   * @param {Object} data 数据对象
   * @param {Function} callback 回调函数，传参：出错信息，渲染后的结果
   * @param {Object} _this 上下文对象
   * @param _sig 状态标记等
   */
  function view_async(async, file, data, callback, _this, _sig) {
    if ( ! _sig) {
      data = _this.get_data(data);
      data.$view = function(_f, _d){
        if ( ! _d || typeof _d !== 'object' || _d.$view !== arguments.callee) {
          _d = _this.get_data(_d);
          _d.$view = arguments.callee;
        }
        return view_async_include(async, file, _f, _d, callback, _this, _sig);
      };

      _sig = {
        included: {}, // 子模板个数（按 id 存储）
        included_all: 0, // 子模板个数（总数）
        data: data, // 最外层数据
        err: [] // 出错信息
      };
    }

    if (typeof _this._i_async[file] === 'number') {
      callback(null, _this._fn[_this._i_async[file]](data, _this._log));
      return;
    }
    if ( ! (file in _this._i_async)) {
      _this._i_async[file] = undefined;
    }

//    console.log(file);
    async(file, _this, function(err, code){
      if (err) {
        callback(err);
        return;
      }

      var index = _this._i_async[file] = _this.compile(code, file);

      if ( ! ('main' in _sig)) {
        _sig.main = index; // 最外层模板的缓存索引
      }
      _sig.included[file] = 0;

      var result = _this._fn[index](data, _this._log);
      if (_sig.included[file] === 0) {
        callback(null, result);
      }
    });
  }

  // 预留接口：JS语法分析器
  var parse_syntax = function(code) {};
  // 预留接口：模板源码语法分析器
  var parse_template = function(code, tag_open, tag_close) {};

  module.exports = {
    _name: 'hjt',
    Hjt: Hjt,
    is_new_engine: function(){
      return _new_engine;
    },
    /**
     * 增加新的异步加载函数
     * @param {String} name 标识，相同标识仅第一次增加的有效
     * @param {Function} async 异步函数
     */
    apply_async: function(name, async) {
      if ( ! name || typeof name !== 'string' || async_cache[name] || typeof async !== 'function') {
        return;
      }

      async_cache[name] = async;
    },
    /**
     * 重置语法分析器
     * @param js_parser {Function} 传参：JS源码；返回值：语法出错的位置（源码的第几个字符），若无语法错误，返回 -1
     * @param tpl_parser {Function} 传参：模板源码；返回值：错误对象 {error:,line:}，若无语法错误，返回 null
     */
    apply_parser: function(js_parser, tpl_parser){
      if (typeof js_parser === 'function') {
        parse_syntax = js_parser;
      }
      if (typeof tpl_parser === 'function') {
        parse_template = tpl_parser;
      }
    }
  };
});