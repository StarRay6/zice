/* 数据接口地址。
   现在指向阿里云函数计算（杭州），答卷直接写进同地域 OSS；
   不再经过任何境外服务，也不需要密钥——云函数只接受匿名提交。
   换地址只改这一行。 */
window.APP_PUBLIC_CONFIG = Object.freeze({
  apiBase: "https://tizhi-submit-eoroqniwzk.cn-hangzhou.fcapp.run"
});
