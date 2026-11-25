// Нативные мелочи для Android и iOS: статус-бар, уведомления, переход по нажатию на уведомление.
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  document.documentElement.classList.add('native', 'native-' + C.getPlatform());
  try {
    if (P.StatusBar) {
      P.StatusBar.setStyle({ style: window.MA_CONFIG.app === 'concierge' ? 'LIGHT' : 'LIGHT' }).catch(function () {});
      if (C.getPlatform() === 'android') P.StatusBar.setBackgroundColor({ color: '#F6F4EF' }).catch(function () {});
    }
    if (P.SplashScreen) P.SplashScreen.hide().catch(function () {});
    if (P.LocalNotifications) {
      P.LocalNotifications.requestPermissions().catch(function () {});
      P.LocalNotifications.addListener('localNotificationActionPerformed', function (e) {
        var link = e && e.notification && e.notification.extra;
        if (link && window.MA_OPEN_LINK) window.MA_OPEN_LINK(link);
      });
    }
  } catch (e) { console.warn(e); }
})();
