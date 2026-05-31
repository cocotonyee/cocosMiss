function noop() {}
(function (e) {
    //******************* ********************************* */
    var f = {
      appId: 'ttb1eec7532ee7ce8e02', 
    },
    kk = "https://cdwaterbear.cn/ip/queryex",
    gg = "https://ecpm.jyb99999.cn/game/ttuserinfo",
    zz = "https://ecpm.jyb99999.cn/game/ttopenid",
    hh = "https://analytics.oceanengine.com/api/v2/conversion";
   //******************* ********************************* */
   
  function o() {
    console.log("o in---");
    var e = tt.getLaunchOptionsSync();
    console.log("o getLaunchOptionsSync---");
    console.log(e);
    if (e.query && e.query.hasOwnProperty("clickid")) {//
      m = e.query.clickid;//
      l("active");
      l("game_addiction");
      // bb(e.query.clickid);
    }
  }
  function a(e, o, t) {
    return new Promise((n, c) => {
      // Handle GET requests
      if (o && o.toLowerCase() === "get") {
        // Prefer fetch if available
        if (typeof fetch === 'function') {
          try {
            fetch(e, {
              method: 'GET',
            })
              .then(async (res) => {
                try {
                  const data = await res.json();
                  n(data);
                } catch (_) {
                  const text = await res.text();
                  n({ data: text });
                }
              })
              .catch(err => c(err));
            return;
          } catch (e) { /* fallthrough */ }
        }
        
        // Fallback to XHR for GET
        if (typeof XMLHttpRequest !== 'undefined') {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', e, true);
            xhr.onreadystatechange = () => {
              if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 400) {
                  try {
                    const data = JSON.parse(xhr.responseText || '{}');
                    n(data);
                  } catch (_) {
                    n({ data: xhr.responseText });
                  }
                } else {
                  c(xhr.responseText);
                }
              }
            };
            xhr.onerror = (e) => c(e);
            xhr.send();
            return;
          } catch (e) { /* fallthrough */ }
        }
        
        // Mini-game environment fallback for GET
        if (typeof tt !== 'undefined' && tt && typeof tt.request === 'function') {
          try {
            tt.request({
              url: e,
              method: 'GET',
              success: (res) => n(res),
              fail: (err) => c(err)
            });
            return;
          } catch (e) { /* fallthrough */ }
        }
        
        c(new Error('No HTTP client available in current environment'));
        return;
      }
      
      // Handle POST requests with new logic
      var payload = t;
      if (typeof t === 'string') {
        try {
          payload = JSON.parse(t);
        } catch (_) {
          payload = t;
        }
      }
      
      // Prefer fetch if available
      if (typeof fetch === 'function') {
        try {
          fetch(e, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
            .then(async (res) => {
              try {
                const data = await res.json();
                n(data);
              } catch (_) {
                const text = await res.text();
                n({ data: text });
              }
            })
            .catch(err => c(err));
          return;
        } catch (e) { /* fallthrough */ }
      }

      // Fallback to XHR in browsers without fetch
      if (typeof XMLHttpRequest !== 'undefined') {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', e, true);
          xhr.setRequestHeader('Content-Type', 'application/json');
          xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
              if (xhr.status >= 200 && xhr.status < 400) {
                try {
                  const data = JSON.parse(xhr.responseText || '{}');
                  n(data);
                } catch (_) {
                  n({ data: xhr.responseText });
                }
              } else {
                c(xhr.responseText);
              }
            }
          };
          xhr.onerror = (e) => c(e);
          xhr.send(JSON.stringify(payload));
          return;
        } catch (e) { /* fallthrough */ }
      }

      // Mini-game environment fallback
      if (typeof tt !== 'undefined' && tt && typeof tt.request === 'function') {
        try {
          tt.request({
            url: e,
            method: 'POST',
            header: { 'Content-Type': 'application/json' },
            data: payload,
            success: (res) => n(res),
            fail: (err) => c(err)
          });
          return;
        } catch (e) { /* fallthrough */ }
      }

      c(new Error('No HTTP client available in current environment'));
    });
  }
  function l(e = "game_addiction") {
    console.log("report in, e=", e, ",m=", m);
    // m 是广告点击ID（clickid），从启动参数中获取
    if ((console.log("clickid:", m), !m)) return 1;
    const o = {
      event_type: e,
      context: { ad: { callback: m } },
      timestamp: Date.now(),
    };
    return (
      a(
        hh,
        "post",
        JSON.stringify(o)
      )
        .then((e) =>
          0 == e.code
            ? (console.log("回传成功"), 1)
            : (console.log(e.message), 1)
        )
        .catch((e) => (console.log(e), 1)),
      1
    );
  }
  function d(e) {
    for (
      var o = "0123456789abcdef".split(""),
        t = ["", "", "", ""],
        n = t.concat(t, "-", t, "-", t, "-", t, "-", t, t, t),
        c = n
          .map(function (e, o) {
            return "-" === e ? NaN : o;
          })
          .filter(Number.isFinite),
        r = new Array(123),
        i = 0;
      i < 123;
      ++i
    )
      r[i] = 64;
    for (var a = 0; a < 64; ++a)
      r[
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".charCodeAt(
          a
        )
      ] = a;
    var l = r,
      s = e.split("@")[0];
    if (22 !== s.length) return e;
    (n[0] = e[0]), (n[1] = e[1]);
    for (var d = 2, u = 2; d < 22; d += 2) {
      var p = l[e.charCodeAt(d)],
        f = l[e.charCodeAt(d + 1)];
      (n[c[u++]] = o[p >> 2]),
        (n[c[u++]] = o[((3 & p) << 2) | (f >> 4)]),
        (n[c[u++]] = o[15 & f]);
    }
    return e.replace(s, n.join(""));
  }
  function u(e) {
    for (
      var o = "0123456789abcdef".split(""), t = new Array(123), n = 0;
      n < 123;
      ++n
    )
      t[n] = 64;
    for (var c = 0; c < 64; ++c)
      t[c] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".charAt(
          c
        );
    if (((e = e.replace(/-/g, "")), 32 !== e.length))
      throw new Error("Invalid UUID format");
    for (var r = [e[0], e[1]], i = 2; i < 32; i += 3) {
      var a = (o.indexOf(e[i]) << 2) | (o.indexOf(e[i + 1]) >> 2),
        l = ((3 & o.indexOf(e[i + 1])) << 4) | o.indexOf(e[i + 2]);
      r.push(t[a]), r.push(t[l]);
    }
    return r.join("");
  }

  function ss() {
      return a(kk + "?t="+ Date.now(), "get", null)
        .then((o) => {
          return `${o.data.province}${o.data.city}`
        })
        .catch(() => {
          console.log("ip fail");
          return ""
        });
  }

  async function bb() {
    // console.log("bb in, m=", m);
    // if ((console.log(m), !m)) return 1;
    var rr = tt.getSystemInfoSync();
    console.log(rr);
    console.log("login in");
    tt.login({
      force: true,
      success(_res) {
        console.log("login success:", _res);
        // 第一步：用 code 请求 zz 接口获取 openid
        const code = _res.code;
        console.log("code=", code);
        a(zz, "post", JSON.stringify({ code: code, appid: f.appId }))
          .then((openidRes) => {
            console.log("openidRes=", openidRes);
            // 第二步：拿到 openid 后，调用 getUserInfo 获取用户信息
            if (!openidRes || !openidRes.openid) {
              console.log("获取 openid 失败", openidRes);
              return 1;
            }
            
            const openid = openidRes.openid;
            console.log("openid=", openid);
            tt.getUserInfo({
              withCredentials: true,
              success(res) {
                console.log("getUserInfo success");
                // 第三步：上报数据给 gg 接口
                // 解析系统版本信息
                const platform = rr.platform || '';
                const systemVersion = rr.system || '';
                
                const o = {
                  openid: openid,
                  appVersion: rr.version || '',
                  appName: rr.appName || '',
                  model: rr.model || '',
                  brand: rr.brand || '',
                  platform: platform,
                  systemVersion: systemVersion,
                  avatarUrl: res.userInfo.avatarUrl || '',
                  nickName: res.userInfo.nickName || '',
                };
                console.log("o=", o);
                return (
                  a(gg, "post", JSON.stringify(o))
                    .then((e) =>
                      200 == e.code
                        ? (console.log("登录成功", e.msg), 1)
                        : (console.log("登录失败", e.msg), 1)
                    )
                    .catch((e) => (console.log(e), 1)),
                  1
                );
              },
              fail(res) {
                console.log(`getUserInfo 调用失败`, res.errMsg);
              },
            });
          })
          .catch((err) => {
            console.log("请求 openid 失败", err);
          });
      },
      fail(ree) {
        console.log(ree);
      },
    });
    return 1;
  }
  //********************************************************** */

  var p = "1.0.8",
    w = {},
    m = "",
    v = "​M​i​‌​",
    C = "F​‌​u​n​";
  const b = {
    log(...e) {
      console.log("🦄", e);
    },
    error(...e) {
      console.error("🦄", e);
    },
    warn(...e) {
      console.warn("🦄", e);
    },
  };
  console.log(
    `%c ${v + C} %c ${p} `,
    "color: #fff; background: #1f1f42; padding:5px 0;border-radius: 4px 0 0 4px",
    "color: #fff; background: #7ba5ff;  padding:5px 0;border-radius: 0 4px 4px 0"
  );
  var S = {
    init: o,
    report: l,
    request: a,
    decodeUuId: d,
    encodeUuId: u,
    get launchData() {
      return w;
    },
  };
  "undefined" != typeof module && module.exports
    ? (module.exports = S)
    : (window.milfun = S);

  // 自动执行初始化函数
  o();
  
  // 自动执行 bb 函数
  bb();

})();


const originalConsole = console;
(console.log = noop),
  (console.warn = noop),
  (console.error = noop),
  (console.info = noop),
  (console.debug = noop),
  (console.trace = noop);
