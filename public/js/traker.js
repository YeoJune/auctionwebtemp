// public/js/traker.js
// Simple script to add Meta Pixel and TikTok Pixel tracking to your pages

// Function to add Meta Pixel code
function addMetaPixel(pixelId = "3072535019552512") {
  // Create script element
  const script = document.createElement("script");
  script.innerHTML = `
      !function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${pixelId}');
      fbq('track', 'PageView');
    `;

  // Add noscript fallback
  const noscript = document.createElement("noscript");
  const img = document.createElement("img");
  img.height = "1";
  img.width = "1";
  img.style.display = "none";
  img.src = `https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`;
  noscript.appendChild(img);

  // Add to document
  document.head.appendChild(script);
  document.head.appendChild(noscript);
}

// Function to add TikTok Pixel code
function addTikTokPixel(pixelId = "CVEGTOJC77UENQD0IMMG") {
  // Create script element
  const script = document.createElement("script");
  script.innerHTML = `
      !function (w, d, t) {
        w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
      var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script")
      ;n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
        ttq.load('${pixelId}');
        ttq.page();
      }(window, document, 'ttq');
    `;

  // Add to document
  document.head.appendChild(script);
}

// Function to add both pixels
function addAllPixels() {
  addMetaPixel();
  addTikTokPixel();
}

// Auto-add pixels when script is included
document.addEventListener("DOMContentLoaded", function () {
  addAllPixels();
});

// Export functions for manual use
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    addMetaPixel,
    addTikTokPixel,
    addAllPixels,
  };
}
