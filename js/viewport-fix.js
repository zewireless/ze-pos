/**
 * viewport-fix.js
 * ──────────────────────────────────────────────────────────────
 * Fixes the classic "100vh cuts off content" bug on tablets/phones.
 *
 * Mobile/tablet browsers report `100vh` as the height of the page
 * with the browser chrome (address bar, tabs) HIDDEN — even while
 * that chrome is still on screen. So `height: 100vh` ends up taller
 * than what's actually visible, and anything pinned to the bottom
 * (like the POS checkout button) gets pushed off-screen.
 *
 * This sets a `--vh` custom property to 1% of the REAL visible
 * height (window.visualViewport when available, since it tracks
 * the on-screen keyboard and browser chrome accurately), kept in
 * sync on resize/orientation change. CSS then uses
 * calc(var(--vh, 1vh) * 100) as a fallback layer, with modern
 * `100dvh` (dynamic viewport height) as the best-case value where
 * supported. Together these three layers (100vh -> --vh -> dvh)
 * guarantee full-height layouts never overflow the real screen,
 * on old and new devices alike.
 */
(function () {
    function setViewportHeightVar() {
        var height = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        document.documentElement.style.setProperty('--vh', (height * 0.01) + 'px');
    }

    setViewportHeightVar();
    window.addEventListener('resize', setViewportHeightVar);
    window.addEventListener('orientationchange', setViewportHeightVar);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', setViewportHeightVar);
    }
})();
