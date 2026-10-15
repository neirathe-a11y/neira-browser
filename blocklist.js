'use strict';

// Curated ad/tracker host blocklist.
// Matches the hostname exactly or as a parent domain (e.g. "ad.doubleclick.net"
// and "doubleclick.net" both match "doubleclick.net").

const TRACKERS = new Set([
    // Google ad / analytics
    'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
    'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
    'adservice.google.com', 'pagead2.googlesyndication.com',
    'partner.googleadservices.com',

    // Facebook / Meta
    'connect.facebook.net', 'pixel.facebook.com', 'atlassbx.com', 'an.facebook.com',

    // Amazon ads
    'amazon-adsystem.com', 'assoc-amazon.com',

    // Twitter / X
    'ads-twitter.com', 'analytics.twitter.com', 'static.ads-twitter.com',

    // Microsoft / Bing
    'bat.bing.com', 'c.bing.com', 'ads.microsoft.com', 'clarity.ms', 'c.clarity.ms',

    // Adobe
    'omtrdc.net', 'demdex.net', 'everesttech.net', 'adobedtm.com', '2o7.net',

    // Criteo
    'criteo.com', 'criteo.net', 'static.criteo.net',

    // Taboola / Outbrain
    'taboola.com', 'taboolanews.com', 'cdn.taboola.com',
    'outbrain.com', 'outbrainimg.com',

    // Ad networks
    'adsafeprotected.com', 'adnxs.com', 'advertising.com', 'serving-sys.com',
    'rubiconproject.com', 'pubmatic.com', 'openx.net', 'indexww.com',
    'casalemedia.com', 'smartadserver.com', 'sharethrough.com', 'yieldmo.com',
    'teads.tv', '3lift.com', 'districtm.io', 'spotxchange.com', 'spotx.tv',
    'tremorhub.com', 'telaria.com',

    // Analytics
    'scorecardresearch.com', 'quantserve.com', 'quantcast.com',
    'hotjar.com', 'static.hotjar.com', 'mixpanel.com',
    'segment.io', 'segment.com', 'amplitude.com', 'heap.io', 'heapanalytics.com',
    'fullstory.com', 'mouseflow.com', 'crazyegg.com', 'luckyorange.com',
    'clicktale.net', 'kissmetrics.com', 'chartbeat.com', 'chartbeat.net',
    'parsely.com', 'newrelic.com', 'nr-data.net', 'bugsnag.com',

    // Marketing / CRM / attribution
    'hubspot.com', 'hs-analytics.net', 'hs-scripts.com', 'hsforms.net',
    'marketo.com', 'marketo.net', 'mktoresp.com', 'pardot.com',
    'salesforceliveagent.com', 'mailchimp.com', 'list-manage.com',
    'klaviyo.com', 'bronto.com', 'braze.com', 'appboy.com',
    'iterable.com', 'customer.io',

    // Mobile / in-app ad SDKs
    'adswizz.com', 'adcolony.com', 'chartboost.com',
    'unityads.unity3d.com', 'applovin.com', 'vungle.com',

    // Pop-up / redirect ad networks
    'popads.net', 'popcash.net', 'propellerads.com', 'adcash.com',
    'onclickads.net', 'clickadu.com', 'exoclick.com', 'juicyads.com',

    // Attribution / mobile analytics
    'kochava.com', 'adjust.com', 'appsflyer.com', 'branch.io',
    'mparticle.com', 'tealiumiq.com', 'tealium.com', 'ensighten.com',

    // Social embeds / trackers
    'addthis.com', 'sharethis.com', 'statcounter.com', 'histats.com', 'sitemeter.com',

    // Fingerprinting
    'fingerprintjs.com', 'fpjs.io', 'fpapi.io', 'deviceatlas.com',

    // Programmatic / DSP
    'doubleverify.com', 'moatads.com', 'iasds01.com', 'adsrvr.org',
    'bidswitch.net', 'bluekai.com', 'krxd.net', 'mathtag.com',
    'turn.com', 'tribalfusion.com', 'exelator.com', 'agkn.com',
    'rlcdn.com', 'crwdcntrl.net'
]);

function shouldBlock(host) {
    if (!host || typeof host !== 'string') return false;
    host = host.toLowerCase().replace(/^www\./, '');
    if (TRACKERS.has(host)) return true;
    let i = 0;
    while ((i = host.indexOf('.', i)) !== -1) {
        const parent = host.slice(i + 1);
        if (TRACKERS.has(parent)) return true;
        i++;
    }
    return false;
}

function isAllowed(host, allowlist) {
    if (!Array.isArray(allowlist) || !allowlist.length) return false;
    host = host.toLowerCase().replace(/^www\./, '');
    return allowlist.some(entry => {
        entry = String(entry || '').toLowerCase().replace(/^www\./, '');
        return entry && (host === entry || host.endsWith('.' + entry));
    });
}

module.exports = { TRACKERS, shouldBlock, isAllowed };