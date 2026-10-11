'use strict';
// Neira Assistant engine. Everything here runs on the device:
//  - collectPage()  runs inside the web page and returns its structure (headings, sections, controls, links)
//  - analyze()      turns that into a written overview (what the page is, what is on it, key takeaways)
//  - answer()       finds the sentences on the page that answer a question
//  - parseMarkdown  renders replies from the optional AI mode
// The output is a list of "blocks" that app.js draws as chat messages.
(function (root) {
    const STOP = new Set(('a about above after again all also am an and any are as at be because been before being below between both but by ' +
        'can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its ' +
        'just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their ' +
        'theirs them then there these they this those through to too under until up us very was we were what when where which while who whom why ' +
        'will with would you your yours may might must shall one two get got via per etc however also within without often many much new use used').split(' '));
    const BOILER = /(cookie|subscribe|newsletter|sign up|sign in|log in|all rights reserved|privacy policy|terms of (use|service)|click here|read more|advertis|share this|follow us|copyright|©|accept all|manage preferences)/i;
    const ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e|Inc|Ltd|Co|St|No|Fig|approx|U\.S|U\.K)\.$/;

    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

    // ------------------------------------------------------------------
    // Runs INSIDE the web page (it is converted to a string and executed there, so it must be self-contained).
    // ------------------------------------------------------------------
    function collectPage() {
        const clean = s => (s || '').replace(/\s+/g, ' ').trim();
        const visible = el => {
            if (!el || !el.getClientRects || !el.getClientRects().length) return false;
            const cs = getComputedStyle(el);
            return cs.visibility !== 'hidden' && cs.display !== 'none';
        };
        const meta = name => {
            const e = document.querySelector('meta[name="' + name + '"],meta[property="' + name + '"]');
            return e ? clean(e.getAttribute('content')) : '';
        };
        const uniq = (arr, n) => [...new Set(arr.filter(Boolean))].slice(0, n);
        const labelOf = el => clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || el.value || '').slice(0, 60);

        const SKIP = 'nav,footer,aside,header,form,script,style,noscript,svg,button,select,textarea,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true]';
        const rootEl = document.querySelector('article') || document.querySelector('[role=main]') || document.querySelector('main') || document.body;

        // Text, grouped under the heading it belongs to
        const sections = [];
        let cur = { heading: '', level: 0, paras: [] };
        sections.push(cur);
        let seen = 0;
        for (const el of rootEl.querySelectorAll('h1,h2,h3,h4,p,li,dd,figcaption')) {
            if (++seen > 4000) break;
            const isHeading = /^H[1-4]$/.test(el.tagName);
            if (!isHeading && el.closest(SKIP)) continue;
            if (!visible(el)) continue;
            const text = clean(el.innerText);
            if (!text) continue;
            if (isHeading) {
                if (text.length > 160) continue;
                cur = { heading: text, level: Number(el.tagName[1]), paras: [] };
                sections.push(cur);
            } else {
                if (el.tagName === 'LI' && el.querySelector('p')) continue;
                if (text.length < (el.tagName === 'LI' ? 20 : 40)) continue;
                cur.paras.push(text.slice(0, 1500));
            }
        }

        // Interface elements (matter for app-like pages)
        const navLinks = uniq([...document.querySelectorAll('nav a,[role=navigation] a')].filter(visible).map(labelOf), 14);
        const asideItems = uniq([...document.querySelectorAll('aside a,aside li,aside button')].filter(visible).map(labelOf), 14);
        const buttons = uniq([...document.querySelectorAll('button,[role=button]')].filter(visible).map(labelOf).filter(t => t.length > 1 && t.length <= 40), 16);
        const inputs = uniq([...document.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true],[role=textbox]')]
            .filter(visible)
            .map(el => clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.name || '')), 8);

        // Prominent links (search results, listings)
        const links = [];
        const seenText = new Set();
        for (const a of rootEl.querySelectorAll('a[href]')) {
            if (links.length >= 14) break;
            if (!visible(a)) continue;
            const text = clean(a.innerText);
            if (text.length < 20 || text.length > 140 || seenText.has(text)) continue;
            seenText.add(text);
            let host = '';
            try { host = new URL(a.href).hostname.replace(/^www\./, ''); } catch (_) { /* ignore */ }
            links.push({ text, host });
        }

        // Structured data (articles, products, videos)
        let ld = null;
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const j = JSON.parse(s.textContent);
                const items = Array.isArray(j) ? j : (j['@graph'] || [j]);
                for (const it of items) {
                    const type = [].concat(it['@type'] || []).join(',');
                    if (!/Product|Article|NewsArticle|BlogPosting|VideoObject|Recipe|Event/.test(type)) continue;
                    const offer = it.offers && (Array.isArray(it.offers) ? it.offers[0] : it.offers);
                    ld = {
                        type,
                        name: clean(it.name || it.headline || ''),
                        description: clean(it.description || '').slice(0, 400),
                        author: clean(typeof it.author === 'string' ? it.author : (it.author && (it.author.name || (it.author[0] && it.author[0].name))) || ''),
                        price: offer ? String(offer.price || offer.lowPrice || '') : '',
                        currency: offer ? String(offer.priceCurrency || '') : '',
                        rating: it.aggregateRating ? String(it.aggregateRating.ratingValue || '') : ''
                    };
                    break;
                }
            } catch (_) { /* ignore malformed JSON-LD */ }
            if (ld) break;
        }

        const timeEl = document.querySelector('time[datetime]');
        const authorEl = document.querySelector('[rel=author]');
        return {
            url: location.href,
            host: location.hostname.replace(/^www\./, ''),
            title: clean(document.title),
            h1: clean((document.querySelector('h1') || {}).innerText || ''),
            lang: document.documentElement.lang || '',
            description: meta('description') || meta('og:description'),
            siteName: meta('og:site_name'),
            ogType: meta('og:type'),
            author: meta('author') || meta('article:author') || (authorEl ? clean(authorEl.innerText) : ''),
            published: meta('article:published_time') || (timeEl ? timeEl.getAttribute('datetime') : ''),
            sections: sections.filter(s => s.heading || s.paras.length),
            navLinks, asideItems, buttons, inputs, links, ld,
            hasPassword: !!document.querySelector('input[type=password]'),
            counts: {
                links: document.links.length, images: document.images.length, forms: document.forms.length,
                videos: document.querySelectorAll('video').length, tables: document.querySelectorAll('table').length,
                code: document.querySelectorAll('pre,code').length
            }
        };
    }

    // ------------------------------------------------------------------
    // Text helpers
    // ------------------------------------------------------------------
    function splitSentences(text) {
        const raw = clean(text).split(/(?<=[.!?]["”’')\]]?)\s+(?=["“‘'(\[]?[A-Z0-9])/);
        const out = [];
        for (const piece of raw) {
            if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += ' ' + piece;
            else out.push(piece);
        }
        return out.filter(Boolean);
    }

    function stem(w) {
        if (w.length > 5) w = w.replace(/(ing|ed|ly|es)$/, '');
        if (w.length > 4) w = w.replace(/s$/, '');
        return w;
    }

    function tokens(s, keepStop = false) {
        const found = String(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
        return found.filter(w => (w.length > 2 || /\d/.test(w)) && (keepStop || !STOP.has(w))).map(stem);
    }

    function trim(s, max) {
        s = clean(s);
        if (s.length <= max) return s;
        const cut = s.slice(0, max);
        const at = cut.lastIndexOf(' ');
        return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, '') + '…';
    }

    // TextRank: sentences that share the most vocabulary with the rest of the page rank highest.
    function rankSentences(sentences) {
        const n = sentences.length;
        if (!n) return [];
        const sets = sentences.map(s => new Set(tokens(s)));
        const w = Array.from({ length: n }, () => new Float64Array(n));
        const rowSum = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = sets[i];
                const b = sets[j];
                if (a.size < 2 || b.size < 2) continue;
                let common = 0;
                for (const t of a) if (b.has(t)) common++;
                if (!common) continue;
                const sim = common / (Math.log(a.size) + Math.log(b.size));
                w[i][j] = w[j][i] = sim;
                rowSum[i] += sim;
                rowSum[j] += sim;
            }
        }
        let score = new Float64Array(n).fill(1);
        for (let it = 0; it < 30; it++) {
            const next = new Float64Array(n);
            for (let i = 0; i < n; i++) {
                let s = 0;
                for (let j = 0; j < n; j++) if (w[j][i] && rowSum[j]) s += (w[j][i] / rowSum[j]) * score[j];
                next[i] = 0.15 + 0.85 * s;
            }
            score = next;
        }
        return sentences.map((s, i) => {
            let sc = score[i];
            if (s.length < 45) sc *= 0.5; else if (s.length > 320) sc *= 0.7;
            if (BOILER.test(s)) sc *= 0.2;
            if (i / n < 0.15) sc *= 1.25;
            if (/\d/.test(s)) sc *= 1.05;
            if (/^(it|this|these|those|they|he|she|however|but|and|also|its)\b/i.test(s)) sc *= 0.75;
            return sc;
        });
    }

    function overlap(a, b) {
        const x = new Set(tokens(a));
        const y = new Set(tokens(b));
        if (!x.size || !y.size) return 0;
        let common = 0;
        for (const t of x) if (y.has(t)) common++;
        return common / Math.min(x.size, y.size);
    }

    // Best k sentences, de-duplicated, returned in reading order.
    function pickTop(sentences, k, exclude = []) {
        const scores = rankSentences(sentences);
        const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
        const chosen = [];
        for (const i of order) {
            if (chosen.length >= k) break;
            const s = sentences[i];
            if (BOILER.test(s) || s.length < 40) continue;
            if (chosen.some(j => overlap(s, sentences[j]) > 0.6)) continue;
            if (exclude.some(e => overlap(s, e) > 0.6)) continue;
            chosen.push(i);
        }
        return chosen.sort((a, b) => a - b).map(i => sentences[i]);
    }

    const listText = (items, quote = true, max = 4) => {
        const xs = items.slice(0, max).map(x => (quote ? `“${x}”` : x));
        if (xs.length <= 1) return xs.join('');
        return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
    };

    function siteName(d) {
        if (d.siteName) return d.siteName;
        const parts = String(d.host || '').split('.');
        return parts.length >= 2 ? parts[parts.length - 2] : (d.host || 'this site');
    }

    function fmtDate(iso) {
        const t = Date.parse(iso);
        if (!t) return '';
        return new Date(t).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    const allParas = d => d.sections.flatMap(s => s.paras);
    const wordCount = d => allParas(d).join(' ').split(/\s+/).filter(Boolean).length;

    // ------------------------------------------------------------------
    // What kind of page is this?
    // ------------------------------------------------------------------
    const KIND_PHRASE = {
        signin: 'a sign-in page',
        video: 'a video page',
        product: 'a product page',
        search: 'a search results page',
        article: 'an article',
        docs: 'a documentation or reference page',
        app: 'a web app interface, not an article or document',
        listing: 'a listing or home page with many links',
        page: 'a short web page'
    };

    function classify(d) {
        const words = wordCount(d);
        const paras = allParas(d).length;
        const ldType = d.ld ? d.ld.type : '';
        if (d.hasPassword && words < 200) return 'signin';
        if (/video/i.test(d.ogType) || /VideoObject/.test(ldType) || (d.counts.videos && words < 400 && /youtube|vimeo|twitch|tiktok|dailymotion/.test(d.host))) return 'video';
        if (/Product/.test(ldType) || /product/i.test(d.ogType)) return 'product';
        if (/[?&](q|query|search|s)=/.test(d.url) && d.links.length >= 4) return 'search';
        if (words >= 350 && paras >= 5) return d.counts.code > 4 ? 'docs' : 'article';
        if ((/Article|BlogPosting/.test(ldType) || /article/i.test(d.ogType)) && words >= 150) return 'article';
        if (words < 200 && (d.inputs.length || d.buttons.length >= 6)) return 'app';
        if (d.links.length >= 8 && words < 400) return 'listing';
        return words >= 120 ? 'article' : 'page';
    }

    // ------------------------------------------------------------------
    // The overview
    // ------------------------------------------------------------------
    function analyze(d) {
        const kind = classify(d);
        const site = siteName(d);
        const cite = site;
        const words = wordCount(d);
        const minutes = Math.max(1, Math.round(words / 220));
        const title = d.h1 && d.h1.length < 120 ? d.h1 : d.title;
        const paras = allParas(d);
        const sentences = splitSentences(paras.join(' ')).slice(0, 320);
        const lead = d.description && d.description.length >= 40 ? trim(d.description, 240) : (pickTop(sentences, 1)[0] || '');
        const blocks = [];
        const stats = { words, minutes, links: d.counts.links, images: d.counts.images, kind };

        // ---- intro paragraph ----
        let intro;
        if (kind === 'app') {
            const parts = [];
            if (d.inputs.length) parts.push(`a text input labeled “${d.inputs[0]}”`);
            if (d.asideItems.length >= 2) parts.push(`a sidebar with ${d.asideItems.length >= 10 ? 'many items' : 'items'} such as ${listText(d.asideItems, true, 3)}`);
            if (d.navLinks.length >= 2) parts.push(`navigation options like ${listText(d.navLinks, false, 4)}`);
            if (!parts.length && d.buttons.length) parts.push(`controls such as ${listText(d.buttons, true, 4)}`);
            intro = `The current page is the **${site}** web app interface, not an article or document.` +
                (parts.length ? ` It shows ${listText(parts, false, 3)}.` : '');
        } else if (kind === 'signin') {
            intro = `This is a sign-in page on **${site}**${d.inputs.length ? ` with fields for ${listText(d.inputs, true, 3)}` : ''}${d.hasPassword ? ' and a password box' : ''}.`;
        } else if (kind === 'search') {
            let q = '';
            try { q = new URL(d.url).searchParams.get('q') || new URL(d.url).searchParams.get('query') || ''; } catch (_) { /* ignore */ }
            intro = `This is a search results page on **${site}**${q ? ` for “${q}”` : ''}. It lists ${d.links.length}+ results.`;
        } else if (kind === 'product') {
            const name = (d.ld && d.ld.name) || title;
            const price = d.ld && d.ld.price ? ` priced at ${d.ld.currency ? d.ld.currency + ' ' : ''}${d.ld.price}` : '';
            intro = `This is a product page on **${site}** for “${trim(name, 90)}”${price}.`;
        } else if (kind === 'video') {
            intro = `This is a video page on **${site}**: “${trim(title, 100)}”${d.author ? ` by ${d.author}` : ''}.${lead ? ' ' + lead : ''}`;
        } else if (kind === 'article' || kind === 'docs') {
            const by = d.author ? `, written by ${d.author}` : '';
            const when = fmtDate(d.published) ? `, published ${fmtDate(d.published)}` : '';
            intro = `This page is ${KIND_PHRASE[kind]} on **${site}** titled “${trim(title, 110)}”${by}${when}.${lead ? ' ' + lead : ''}`;
        } else {
            intro = `This is ${KIND_PHRASE[kind]} on **${site}**${title ? `: “${trim(title, 100)}”` : ''}.${lead ? ' ' + lead : ''}`;
        }
        blocks.push({ t: 'p', text: intro, cite });

        // ---- "What's on the page" ----
        const items = [];
        const add = (label, text, extra = {}) => { if (text) items.push({ label, text, cite, ...extra }); };
        const headings = d.sections.filter(s => s.heading).map(s => s.heading);

        if (kind === 'app' || kind === 'signin') {
            if (d.inputs.length) add('Main area', `${d.inputs.length > 1 ? 'Inputs' : 'A text input'} labeled ${listText(d.inputs, true, 3)}${d.buttons.length ? `, with controls for ${listText(d.buttons, false, 3)}` : ''}.`);
            if (d.asideItems.length >= 2) add('Sidebar', `Lists items such as ${listText(d.asideItems, true, 5)}.`);
            if (d.navLinks.length >= 2) add('Navigation', `Options include ${listText(d.navLinks, false, 8)}.`);
            if (!d.inputs.length && d.buttons.length) add('Controls', `Buttons such as ${listText(d.buttons, true, 6)}.`);
            if (headings.length) add('Headings', `${listText(headings, true, 4)}.`);
            const firstPara = paras[0];
            if (firstPara) add('Visible text', `“${trim(firstPara, 140)}”`);
        } else if (kind === 'search') {
            for (const l of d.links.slice(0, 6)) items.push({ label: trim(l.text, 90), text: l.host, sep: ' — ' });
        } else if (kind === 'listing') {
            for (const l of d.links.slice(0, 7)) items.push({ label: trim(l.text, 90), text: l.host ? `(${l.host})` : '', sep: ' ' });
            if (headings.length) add('Sections', `${listText(headings, true, 5)}.`);
        } else if (kind === 'product') {
            const priceMatch = !d.ld || !d.ld.price ? (paras.slice(0, 40).join(' ').match(/[$£€₹]\s?\d[\d,]*(?:\.\d{2})?/) || [])[0] : '';
            if (d.ld && d.ld.price) add('Price', `${d.ld.currency ? d.ld.currency + ' ' : ''}${d.ld.price}`);
            else if (priceMatch) add('Price', priceMatch);
            const rating = (d.ld && d.ld.rating) || ((paras.join(' ').match(/(\d(?:\.\d)?)\s*(?:out of|\/)\s*5/) || [])[1]);
            if (rating) add('Rating', `${rating} out of 5`);
            const hi = paras.filter(p => p.length >= 30 && p.length <= 140).slice(0, 4);
            if (hi.length) add('Highlights', hi.map(h => trim(h, 100)).join(' · '));
            if (lead) add('Description', trim(lead, 200));
        } else {
            // articles, docs, videos, short pages: one bullet per section, using its best sentence
            const freq = new Map();
            for (const s of sentences) for (const t of tokens(s)) freq.set(t, (freq.get(t) || 0) + 1);
            const best = text => {
                const ss = splitSentences(text).filter(s => s.length >= 40 && !BOILER.test(s));
                let top = null;
                let topScore = -1;
                ss.forEach((s, i) => {
                    const ts = tokens(s);
                    let sc = ts.reduce((a, t) => a + (freq.get(t) || 0), 0) / Math.sqrt(ts.length || 1);
                    if (i === 0) sc *= 1.3;
                    if (sc > topScore) { top = s; topScore = sc; }
                });
                return top;
            };
            for (const sec of d.sections) {
                if (items.length >= 6) break;
                if (!sec.heading || sec.level > 3 || !sec.paras.length) continue;
                if (sec.heading === d.h1 || BOILER.test(sec.heading)) continue;
                const sentence = best(sec.paras.join(' '));
                if (sentence) add(trim(sec.heading, 70), trim(sentence, 220));
            }
        }
        if (items.length) {
            blocks.push({ t: 'h', text: kind === 'article' || kind === 'docs' ? 'Main sections' : 'What’s on the page' });
            blocks.push({ t: 'ul', items });
        }

        // ---- key takeaways ----
        const used = items.map(i => i.text);
        if (['article', 'docs', 'page', 'video', 'product'].includes(kind) && sentences.length >= 4) {
            const points = pickTop(sentences, kind === 'article' || kind === 'docs' ? 4 : 3, [lead, ...used]).map(s => ({ text: trim(s, 260), cite }));
            if (points.length) {
                blocks.push({ t: 'h', text: 'Key takeaways' });
                blocks.push({ t: 'ul', items: points });
            }
        }

        // ---- closing note ----
        if ((kind === 'app' || kind === 'signin' || kind === 'listing') && words < 120) {
            blocks.push({ t: 'p', text: `There is no substantive article content to summarize beyond the ${kind === 'listing' ? 'links' : 'interface'} itself.`, cite });
        }
        return { kind, blocks, stats };
    }

    function summarizeSelection(text) {
        const clean0 = clean(text);
        const words = clean0.split(/\s+/).filter(Boolean).length;
        const sentences = splitSentences(clean0).filter(s => s.length > 20);
        if (words < 25 || sentences.length < 3) {
            return { kind: 'selection', blocks: [{ t: 'p', text: `That selection is already short (${words} words). Select a longer passage and try again.` }], stats: { words } };
        }
        const k = words > 700 ? 5 : words > 250 ? 4 : 3;
        const points = pickTop(sentences, k).map(s => ({ text: trim(s, 260) }));
        return {
            kind: 'selection',
            blocks: [
                { t: 'p', text: `Here are the main points of your selection (${words} words):` },
                { t: 'ul', items: points }
            ],
            stats: { words }
        };
    }

    // ------------------------------------------------------------------
    // Questions about the page
    // ------------------------------------------------------------------
    function boldMatches(sentence, qTokens) {
        return sentence.replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, w => (qTokens.has(stem(w.toLowerCase())) ? `**${w}**` : w));
    }

    // Words a question might use for what the page actually says, plus the kind of fact being asked for.
    function expandQuery(q) {
        const extra = [];
        const want = {};
        const add = (...words) => { for (const w of words) extra.push(stem(w)); };
        if (/\b(tall|high|height|how big|how large|size|dimension|long|wide|width|deep|depth)\b/i.test(q)) { add('high', 'height', 'tall', 'metres', 'meters', 'feet', 'size', 'long', 'wide', 'deep', 'ft'); want.number = true; }
        if (/\b(price|cost|costs|expensive|cheap|how much|pay|fee|fees)\b/i.test(q)) { add('price', 'cost', 'fee', 'priced', 'pay', 'usd', 'free'); want.number = true; }
        if (/\bhow (many|much|often|long|old|far|fast)\b/i.test(q)) want.number = true;
        if (/\b(when|what year|what date|how old|date)\b/i.test(q)) { add('year', 'date', 'founded', 'built', 'born', 'opened', 'inaugurated', 'completed', 'began', 'started', 'released'); want.year = true; }
        if (/\bwho\b/i.test(q)) { add('designed', 'built', 'created', 'founded', 'wrote', 'invented', 'named', 'founder', 'engineer', 'author'); want.name = true; }
        if (/\b(where|located|location)\b/i.test(q)) { add('located', 'location', 'situated', 'based', 'city', 'country'); want.place = true; }
        if (/\b(why|reason|because)\b/i.test(q)) add('because', 'reason', 'since', 'due');
        if (/\b(made of|material|built from|constructed)\b/i.test(q)) add('made', 'material', 'iron', 'steel', 'wood', 'built', 'constructed');
        return { extra, want };
    }

    function answer(question, d) {
        const q = clean(question);
        const lower = q.toLowerCase();
        const site = siteName(d);
        const paras = allParas(d);
        const wrap = blocks => ({ blocks, stats: {} });

        if (/^(summari[sz]e|summary|tl;?dr|overview|what is this|what's this|what is on|what's on)/.test(lower)) return Object.assign(analyze(d), { intent: 'summary' });
        if (/\b(outline|sections|contents|structure|headings?)\b/.test(lower)) {
            const hs = d.sections.filter(s => s.heading && s.level <= 3).map(s => ({ text: s.heading }));
            return wrap(hs.length ? [{ t: 'p', text: 'Here is the outline of this page:' }, { t: 'ul', items: hs.slice(0, 20) }] : [{ t: 'p', text: 'This page does not have clear headings.' }]);
        }
        if (/\b(who wrote|author|written by|byline)\b/.test(lower)) {
            return wrap([{ t: 'p', text: d.author ? `The author listed on this page is **${d.author}**.` : 'I could not find an author on this page.' }]);
        }
        if (/\b(when|date|published|updated)\b/.test(lower) && /\b(publish|written|posted|date|updated)\b/.test(lower)) {
            return wrap([{ t: 'p', text: fmtDate(d.published) ? `This page was published on **${fmtDate(d.published)}**.` : 'I could not find a publication date on this page.' }]);
        }
        if (/\b(links?|sources?|references?)\b/.test(lower) && d.links.length) {
            return wrap([{ t: 'p', text: 'Prominent links on this page:' }, { t: 'ul', items: d.links.slice(0, 10).map(l => ({ label: trim(l.text, 90), text: l.host, sep: ' — ' })) }]);
        }
        if (/\b(numbers?|statistics|stats|figures|data|percent)\b/.test(lower)) {
            const nums = splitSentences(paras.join(' ')).filter(s => /\d/.test(s) && s.length > 30 && !BOILER.test(s)).slice(0, 6);
            return wrap(nums.length ? [{ t: 'p', text: 'Sentences with figures from this page:' }, { t: 'ul', items: nums.map(s => ({ text: trim(s, 240), cite: site })) }]
                : [{ t: 'p', text: 'I did not find any figures on this page.' }]);
        }
        if (/\b(key points?|takeaways?|main points?|important)\b/.test(lower)) {
            const ss = splitSentences(paras.join(' ')).slice(0, 320);
            const pts = pickTop(ss, 5).map(s => ({ text: trim(s, 260), cite: site }));
            return wrap(pts.length ? [{ t: 'p', text: 'The key points on this page:' }, { t: 'ul', items: pts }] : [{ t: 'p', text: 'There is not enough text on this page to pull out key points.' }]);
        }

        // General question: rank the page's sentences against it (BM25)
        const qTokens = new Set(tokens(q));
        const expanded = expandQuery(q);
        const qWeak = new Set(expanded.extra.filter(t => !qTokens.has(t)));
        if (!qTokens.size && !qWeak.size) return wrap([{ t: 'p', text: 'Ask about something specific on this page, for example “What does it say about pricing?”' }]);

        const docs = [];
        for (const sec of d.sections) {
            for (const para of sec.paras) {
                for (const s of splitSentences(para)) {
                    if (s.length >= 30 && !BOILER.test(s)) docs.push({ text: s, heading: sec.heading, toks: tokens(s) });
                }
            }
        }
        if (!docs.length) return wrap([{ t: 'p', text: 'There is not enough text on this page to answer questions.' }]);
        const avg = docs.reduce((a, x) => a + x.toks.length, 0) / docs.length || 1;
        const df = new Map();
        for (const doc of docs) for (const t of new Set(doc.toks)) df.set(t, (df.get(t) || 0) + 1);
        const N = docs.length;
        const scored = docs.map(doc => {
            const tf = new Map();
            for (const t of doc.toks) tf.set(t, (tf.get(t) || 0) + 1);
            let score = 0;
            for (const [set, weight] of [[qTokens, 1], [qWeak, 0.6]]) {
                for (const t of set) {
                    const f = tf.get(t) || 0;
                    if (!f) continue;
                    const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
                    score += weight * idf * ((f * 2.5) / (f + 1.5 * (0.25 + 0.75 * (doc.toks.length / avg))));
                }
            }
            if (score > 0) {
                if (expanded.want.number && /\d/.test(doc.text)) score *= 1.35;
                if (expanded.want.year && /\b(1[0-9]{3}|20[0-9]{2})\b/.test(doc.text)) score *= 1.35;
                if (expanded.want.name && /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(doc.text)) score *= 1.2;
            }
            if (doc.heading && tokens(doc.heading).some(t => qTokens.has(t))) score *= 1.4;
            return { doc, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

        if (!scored.length) return wrap([{ t: 'p', text: `I couldn’t find anything about “${trim(q, 60)}” on this page.` }]);
        const picked = [];
        const floor = scored[0].score * 0.45;
        for (const x of scored) {
            if (picked.length >= 3 || x.score < floor) break;
            if (picked.some(p => overlap(p.doc.text, x.doc.text) > 0.7)) continue;
            picked.push(x);
        }
        return wrap([
            { t: 'p', text: `Here’s what **${site}** says about this:` },
            { t: 'ul', items: picked.map(x => ({ label: x.doc.heading && x.doc.heading !== d.h1 && x.doc.heading !== d.title ? trim(x.doc.heading, 60) : '', text: boldMatches(trim(x.doc.text, 280), qTokens), cite: site })) }
        ]);
    }

    // ------------------------------------------------------------------
    // Markdown (replies from the optional AI mode) -> the same block format
    // ------------------------------------------------------------------
    function parseMarkdown(md) {
        const lines = String(md || '').replace(/\r/g, '').split('\n');
        const blocks = [];
        let para = [];
        let list = null;
        let code = null;
        const flushPara = () => { if (para.length) { blocks.push({ t: 'p', text: para.join(' ') }); para = []; } };
        const flushList = () => { if (list) { blocks.push(list); list = null; } };
        for (const line of lines) {
            if (code) {
                if (/^\s*```/.test(line)) { blocks.push({ t: 'code', text: code.join('\n') }); code = null; } else code.push(line);
                continue;
            }
            if (/^\s*```/.test(line)) { flushPara(); flushList(); code = []; continue; }
            let m;
            if ((m = /^\s{0,3}(#{1,4})\s+(.*)$/.exec(line))) { flushPara(); flushList(); blocks.push({ t: 'h', text: m[2].trim() }); }
            else if ((m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line))) {
                flushPara();
                const ordered = /^\s*\d/.test(line);
                if (!list || list.ordered !== ordered) { flushList(); list = { t: 'ul', ordered, items: [] }; }
                list.items.push({ text: m[1].trim() });
            } else if (/^\s*$/.test(line)) { flushPara(); flushList(); }
            else if (list && /^\s{2,}\S/.test(line)) list.items[list.items.length - 1].text += ' ' + line.trim();
            else { flushList(); para.push(line.trim()); }
        }
        if (code) blocks.push({ t: 'code', text: code.join('\n') });
        flushPara();
        flushList();
        return blocks;
    }

    // "**bold** and `code`" -> [{ t:'b'|'code'|'text', text }]  (links keep their text only)
    function inlineParts(text) {
        const src = String(text).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
        const parts = [];
        const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
        let last = 0;
        let m;
        while ((m = re.exec(src))) {
            if (m.index > last) parts.push({ t: 'text', text: src.slice(last, m.index) });
            parts.push(m[1] !== undefined ? { t: 'b', text: m[1] } : { t: 'code', text: m[2] });
            last = m.index + m[0].length;
        }
        if (last < src.length) parts.push({ t: 'text', text: src.slice(last) });
        return parts;
    }

    // Plain text of a reply (for the Copy button)
    function blocksToText(blocks) {
        const strip = s => inlineParts(s).map(p => p.text).join('');
        return blocks.map(b => {
            if (b.t === 'h') return strip(b.text).toUpperCase();
            if (b.t === 'p') return strip(b.text);
            if (b.t === 'code') return b.text;
            if (b.t === 'ul') return b.items.map((it, i) => `${b.ordered ? i + 1 + '.' : '•'} ${it.label ? strip(it.label) + (it.sep || ': ') : ''}${strip(it.text)}`).join('\n');
            return '';
        }).join('\n\n');
    }

    // Plain text handed to the AI model: title, description, headings and paragraphs (and the controls, for app-like pages)
    function pageContext(d) {
        const out = [];
        out.push('Title: ' + d.title);
        out.push('URL: ' + d.url);
        if (d.description) out.push('Description: ' + d.description);
        if (d.author) out.push('Author: ' + d.author);
        if (d.published) out.push('Published: ' + d.published);
        const words = wordCount(d);
        if (words < 200) {
            if (d.inputs.length) out.push('Inputs: ' + d.inputs.join('; '));
            if (d.navLinks.length) out.push('Navigation: ' + d.navLinks.join('; '));
            if (d.asideItems.length) out.push('Sidebar: ' + d.asideItems.join('; '));
            if (d.buttons.length) out.push('Buttons: ' + d.buttons.join('; '));
        }
        out.push('');
        for (const s of d.sections) {
            if (s.heading) out.push('\n' + '#'.repeat(Math.max(1, Math.min(4, s.level))) + ' ' + s.heading);
            for (const p of s.paras) out.push(p);
        }
        return out.join('\n').slice(0, 40000);
    }

    const api = { pageContext, collectPage, classify, analyze, summarizeSelection, answer, parseMarkdown, inlineParts, blocksToText, splitSentences, pickTop, trim, wordCount };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.NeiraAssistant = api;
})(typeof window !== 'undefined' ? window : globalThis);