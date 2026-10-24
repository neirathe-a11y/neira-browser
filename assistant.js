'use strict';
// Neira Assistant engine. Everything here runs on the device:
//  - collectPage()  runs inside the web page and returns its structure (headings, sections, controls, links)
//  - analyze()      turns that into a written overview (what the page is, what is on it, key takeaways)
//  - answer()       finds the sentences on the page that answer a question
//  - parseMarkdown  renders replies from the optional AI mode
//  - createOllamaClient / analyzeWithAI / answerWithAI / summarizeSelectionWithAI
//                   optional AI mode: streams from a local Ollama server (http://localhost:11434 by default)
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

    // ------------------------------------------------------------------
    // Page context for the AI model (plain text, trimmed to a character budget)
    // ------------------------------------------------------------------
    const CONTEXT_DEFAULT_CHARS = 12000;
    const TRIM_NOTE = '[Note: this page was long, so some paragraphs were left out.]';

    // Lower-case, punctuation-free key used to spot duplicate paragraphs and to locate a selection.
    const textKey = s => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

    // Drops paragraphs that already appeared earlier on the page (menus, repeated captions, cards...).
    function dedupeSections(sections) {
        const seen = new Set();
        const out = [];
        for (const s of sections) {
            const paras = [];
            for (const p of s.paras) {
                const k = textKey(p);
                if (!k || seen.has(k)) continue;
                seen.add(k);
                paras.push(p);
            }
            if (s.heading || paras.length) out.push({ heading: s.heading, level: s.level, paras });
        }
        return out;
    }

    // Which section (and paragraph) holds the selected text? { i: -1 } when nothing matches.
    function nearestSection(secs, selection) {
        const none = { i: -1, p: -1 };
        const sel = clean(selection);
        if (!sel) return none;
        const selKey = textKey(sel);
        const probes = [selKey.slice(0, 60)];
        if (selKey.length > 120) probes.push(selKey.slice(-60));
        if (probes.some(x => x.length >= 12)) {
            for (let i = 0; i < secs.length; i++) {
                for (let p = 0; p < secs[i].paras.length; p++) {
                    const k = textKey(secs[i].paras[p]);
                    if (probes.some(x => x.length >= 12 && k.includes(x))) return { i, p };
                }
            }
        }
        // Fallback: the section that shares the most vocabulary with the selection
        const st = new Set(tokens(sel));
        if (!st.size) return none;
        let best = none;
        let bestScore = 0;
        secs.forEach((sec, i) => {
            const hit = new Set();
            for (const t of tokens(sec.heading + ' ' + sec.paras.join(' '))) if (st.has(t)) hit.add(t);
            const score = hit.size / st.size;
            if (score > bestScore) { bestScore = score; best = { i, p: -1 }; }
        });
        return bestScore >= 0.3 ? best : none;
    }

    // Builds the context string and reports how much was trimmed.
    // Options: maxChars (default 12000), selection (selected text), question (to find matching headings).
    function buildContext(d, o) {
        o = o || {};
        const maxChars = Math.max(500, Math.floor(Number(o.maxChars)) || CONTEXT_DEFAULT_CHARS);
        const selection = clean(o.selection);
        const question = clean(o.question);

        // Always kept: title, URL, description, author, date (+ controls on app-like pages, + the selection)
        const head = [];
        head.push('Title: ' + d.title);
        head.push('URL: ' + d.url);
        if (d.description) head.push('Description: ' + trim(d.description, 800));
        if (d.author) head.push('Author: ' + d.author);
        if (d.published) head.push('Published: ' + d.published);
        if (wordCount(d) < 200) {
            if (d.inputs.length) head.push('Inputs: ' + d.inputs.join('; '));
            if (d.navLinks.length) head.push('Navigation: ' + d.navLinks.join('; '));
            if (d.asideItems.length) head.push('Sidebar: ' + d.asideItems.join('; '));
            if (d.buttons.length) head.push('Buttons: ' + d.buttons.join('; '));
        }
        if (selection) head.push('Selected text: ' + trim(selection, 3000));

        const secs = dedupeSections(d.sections || []);
        const items = secs.map(s => ({
            s,
            // every heading is always kept, so the main headings survive any trimming
            line: s.heading ? '\n' + '#'.repeat(Math.max(1, Math.min(4, s.level))) + ' ' + s.heading : '',
            paras: s.paras.map(t => ({ t, text: t, on: false }))
        }));
        const assemble = note => {
            const out = head.slice();
            if (note) out.push(note);
            out.push('');
            for (const it of items) {
                if (it.line) out.push(it.line);
                for (const p of it.paras) if (p.on) out.push(p.text);
            }
            return out.join('\n');
        };

        // Everything (de-duplicated) fits: send it all
        items.forEach(it => it.paras.forEach(p => { p.on = true; }));
        const full = assemble('');
        const originalChars = full.length;
        if (originalChars <= maxChars) return { context: full, originalChars, sentChars: originalChars, truncated: false };
        items.forEach(it => it.paras.forEach(p => { p.on = false; }));

        // Too long. Step 1: the first paragraph of every section is always kept (shortened only if even that cannot fit).
        const firsts = items.filter(it => it.paras.length);
        const base = assemble(TRIM_NOTE).length;
        // The selection's own section gets up to 30% of the budget before the other first paragraphs are shortened.
        const hit = selection ? nearestSection(secs, selection) : { i: -1, p: -1 };
        let reserve = 0;
        if (hit.i >= 0) {
            const wanted = items[hit.i].paras.slice(1).reduce((a, p) => a + p.t.length + 1, 0);
            reserve = Math.min(wanted, Math.floor(maxChars * 0.3));
        }
        let cap = 1500;
        for (const c of [1500, 600, 300, 160, 80]) {
            cap = c;
            const need = firsts.reduce((a, it) => a + Math.min(it.paras[0].t.length, c + 1) + 1, 0);
            if (base + need + reserve <= maxChars) break;
        }
        let used = base;
        for (const it of firsts) {
            const p = it.paras[0];
            p.text = p.t.length > cap ? trim(p.t, cap) : p.t;
            p.on = true;
            used += p.text.length + 1;
        }

        const room = () => maxChars - used;
        const inOrder = it => it.paras.map((_, k) => k);
        const addFrom = (it, order, limit) => {
            let spent = 0;
            for (const k of order) {
                const p = it.paras[k];
                if (!p || p.on) continue;
                const cost = p.text.length + 1;
                if (cost > room() || spent + cost > limit) continue;
                p.on = true;
                used += cost;
                spent += cost;
            }
            return spent;
        };

        // Step 2: fill the remaining space by priority.
        // (1+2) The selection's own section, nearest paragraphs first
        if (hit.i >= 0) {
            const it = items[hit.i];
            const centre = Math.max(0, hit.p);
            addFrom(it, inOrder(it).sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre)), Infinity);
            const hp = it.paras[centre];
            if (hp && hp.on && hp.text !== hp.t && hp.t.length - hp.text.length <= room()) { used += hp.t.length - hp.text.length; hp.text = hp.t; }
        }
        // (3) The beginning of the page (limited to 40% of what is left, so later priorities still get room)
        let left = Math.floor(room() * 0.4);
        for (const it of items) {
            if (left <= 0) break;
            left -= addFrom(it, inOrder(it), left);
        }
        // (4) Sections whose heading matches the question
        const qt = new Set(tokens(question));
        if (qt.size) for (const it of items) if (it.s.heading && tokens(it.s.heading).some(t => qt.has(t))) addFrom(it, inOrder(it), Infinity);
        // (5) Anything else, in reading order
        for (const it of items) addFrom(it, inOrder(it), Infinity);

        let context = assemble(TRIM_NOTE);
        if (context.length > maxChars) context = context.slice(0, maxChars - 1) + '…'; // safety net
        return { context, originalChars, sentChars: context.length, truncated: true };
    }

    // pageContext(d)                       -> string, up to 12000 characters (same return type as before)
    // pageContext(d, 8000)                 -> string, up to 8000 characters
    // pageContext(d, 8000, { selection, question, meta: true })  -> { context, originalChars, sentChars, truncated }
    // pageContext(d, { maxChars, selection, question, meta })    -> same, options in one object
    function pageContext(d, maxChars, opts) {
        if (maxChars && typeof maxChars === 'object') { opts = maxChars; maxChars = opts.maxChars; }
        const o = Object.assign({}, opts, { maxChars: maxChars === undefined ? CONTEXT_DEFAULT_CHARS : maxChars });
        const r = buildContext(d, o);
        return o.meta ? r : r.context;
    }

    // A short excerpt around the selection (used next to the selected text in AI prompts).
    function selectionExcerpt(d, selection, maxChars) {
        const lines = ['Title: ' + d.title, 'URL: ' + d.url];
        const secs = dedupeSections(d.sections || []);
        const hit = nearestSection(secs, selection);
        if (hit.i >= 0) {
            const sec = secs[hit.i];
            if (sec.heading) lines.push('Section: ' + sec.heading);
            const selKey = textKey(selection);
            let used = lines.join('\n').length;
            const centre = Math.max(0, hit.p);
            const order = sec.paras.map((_, k) => k).sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
            const keep = new Map();
            for (const k of order) {
                const key = textKey(sec.paras[k]);
                if (key && selKey.includes(key)) continue; // already inside the selection
                const text = sec.paras[k].length > 700 ? trim(sec.paras[k], 700) : sec.paras[k];
                if (used + text.length + 1 > maxChars) continue;
                keep.set(k, text);
                used += text.length + 1;
            }
            for (const k of [...keep.keys()].sort((a, b) => a - b)) lines.push(keep.get(k));
        }
        return lines.join('\n');
    }

    // ------------------------------------------------------------------
    // Optional AI mode: a local Ollama server (nothing leaves the device)
    // ------------------------------------------------------------------
    const OLLAMA_DEFAULTS = Object.freeze({
        baseUrl: 'http://localhost:11434',
        model: 'qwen3:8b-q4_K_M',
        num_ctx: 16384,
        temperature: 0.2,
        num_predict: 1024,
        think: false,       // Qwen3: skip the long "thinking" phase (sent to Ollama as `think`)
        stripThink: true    // also remove any <think>…</think> that older Ollama versions put in the text
    });

    const SYSTEM_PROMPT = [
        'You are Neira, a private local browsing assistant. You receive text extracted from the user’s current webpage or selected text.',
        '',
        'Rules:',
        '- Answer primarily from the provided page context.',
        '- If the answer is not in the context, say so briefly instead of guessing.',
        '- Do not invent facts, quotes, citations, prices, dates, or page content.',
        '- Be concise and well formatted.',
        '- Use Markdown: short paragraphs, bullet points, headings only when useful, and code blocks for code.',
        '- For math, show the essential steps and clearly label the final answer.',
        '- If units are present, preserve and convert them correctly.',
        '- If the question is ambiguous, state your assumption briefly before answering.'
    ].join('\n');

    // Errors from the AI mode carry a machine-readable `code`:
    //   'not_running' | 'cors' | 'model_not_found' | 'aborted' | 'http_error' | 'stream_error' |
    //   'network' | 'empty_response' | 'bad_request' | 'unsupported'
    // `err.partial` holds any text received before the failure or cancellation.
    function aiError(code, message, extra) {
        const e = new Error(message);
        e.name = 'NeiraAIError';
        e.code = code;
        return Object.assign(e, extra);
    }

    const isAbort = e => !!e && (e.name === 'AbortError' || e.code === 20);

    function partialTagLen(buf, tag) {
        for (let n = Math.min(tag.length - 1, buf.length); n > 0; n--) if (tag.startsWith(buf.slice(buf.length - n))) return n;
        return 0;
    }

    // Removes <think>…</think> from a stream, even when a tag is split across chunks.
    function makeThinkFilter() {
        let buf = '';
        let inThink = false;
        return {
            push(chunk) {
                buf += chunk;
                let out = '';
                for (;;) {
                    if (inThink) {
                        const end = buf.indexOf('</think>');
                        if (end < 0) { buf = buf.slice(Math.max(0, buf.length - 7)); return out; }
                        buf = buf.slice(end + 8).replace(/^\s+/, '');
                        inThink = false;
                    } else {
                        const start = buf.indexOf('<think>');
                        if (start < 0) {
                            const keep = partialTagLen(buf, '<think>');
                            out += buf.slice(0, buf.length - keep);
                            buf = buf.slice(buf.length - keep);
                            return out;
                        }
                        out += buf.slice(0, start);
                        buf = buf.slice(start + 7);
                        inThink = true;
                    }
                }
            },
            flush() { const rest = inThink ? '' : buf; buf = ''; return rest; }
        };
    }

    function createOllamaClient(options) {
        const cfg = Object.assign({}, OLLAMA_DEFAULTS, options || {});
        const base = () => String(cfg.baseUrl || OLLAMA_DEFAULTS.baseUrl).replace(/\/+$/, '');
        let controller = null;

        const doFetch = (url, init) => {
            const f = cfg.fetch || root.fetch;
            if (typeof f !== 'function') throw aiError('unsupported', 'This environment has no fetch(), so the AI mode cannot run.');
            return f.call(root, url, init);
        };
        const GROQ_DEFAULTS = Object.freeze({ model: 'openai/gpt-oss-20b', num_ctx: 8192, temperature: 0.2, num_predict: 1024 });

function createGroqClient(options) {
    const cfg = Object.assign({}, GROQ_DEFAULTS, options || {});
    let current = null;

    async function chat(args) {
        const { messages, onToken, onDone, signal, model, options: gen } = args || {};
        if (!Array.isArray(messages) || !messages.length) throw aiError('bad_request', 'No messages to send to the model.');
        const bridge = root.neiraGroq;
        if (!bridge) throw aiError('unsupported', 'The Groq bridge is missing (preload.js was not updated).');

        if (current) current.abort();
        const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const abort = () => bridge.abort(id);
        const state = { abort };
        current = state;
        let full = '';
        const off = bridge.onToken((rid, chunk) => { if (rid === id) { full += chunk; if (onToken) onToken(chunk); } });
        if (signal) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }

        try {
            const r = await bridge.chat(id, {
                messages,
                model: model || cfg.model,
                temperature: gen && gen.temperature !== undefined ? gen.temperature : cfg.temperature,
                max_tokens: gen && gen.num_predict !== undefined ? gen.num_predict : cfg.num_predict
            });
            if (!r.ok) {
                if (r.code === 'aborted') throw aiError('aborted', 'Generation cancelled.', { partial: full });
                const msg = { no_key: 'Add your Groq API key first.', bad_key: 'Groq rejected the API key.', rate_limit: 'Groq is rate-limiting you. Wait a few seconds and try again.' }[r.code] || r.message || 'Groq request failed.';
                throw aiError(r.code || 'http_error', msg, { partial: full, status: r.status });
            }
            if (onDone) onDone(full, { done_reason: r.finishReason === 'length' ? 'length' : 'stop' });
            return full;
        } catch (e) {
            if (e && e.name === 'NeiraAIError') { e.partial = full; throw e; }
            throw aiError('network', 'Groq request failed: ' + clean(e && e.message).slice(0, 160), { partial: full });
        } finally {
            off();
            if (signal) signal.removeEventListener('abort', abort);
            if (current === state) current = null;
        }
    }

    const abort = () => { if (current) current.abort(); };
    const isStreaming = () => current !== null;
    const getConfig = () => ({ baseUrl: 'groq', model: cfg.model, num_ctx: cfg.num_ctx, temperature: cfg.temperature, num_predict: cfg.num_predict });
    async function ping() {
        try {
            const s = await root.neiraGroq.status();
            return s.hasKey ? { available: true, modelInstalled: true, models: [cfg.model] } : { available: false, reason: 'no_key' };
        } catch (_) { return { available: false, reason: 'unsupported' }; }
    }
    return { chat, abort, isStreaming, ping, getConfig };
}

        // A failed fetch() looks the same whether Ollama is off or the browser blocked the request (CORS).
        // A "no-cors" probe tells them apart: it only fails when nothing is listening.
        async function diagnoseNetwork() {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 2500);
            try {
                await doFetch(base() + '/api/version', { mode: 'no-cors', signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
                return 'cors';
            } catch (_) {
                return 'not_running';
            } finally {
                clearTimeout(timer);
            }
        }

        const notRunning = cause => aiError('not_running', `Couldn’t reach Ollama at ${base()}. Make sure Ollama is running (for example: ollama serve).`, { cause });
        const corsBlocked = cause => aiError('cors', `Ollama is running at ${base()}, but the request was blocked (network/CORS). Start Ollama with OLLAMA_ORIGINS set to allow this app’s origin.`, { cause });
        const modelMissing = name => aiError('model_not_found', `The model “${name}” isn’t installed in Ollama. Install it with: ollama pull ${name}`);

        async function chat(args) {
            const { messages, onToken, onDone, signal, model, options: gen } = args || {};
            if (!Array.isArray(messages) || !messages.length) throw aiError('bad_request', 'No messages to send to the model.');

            if (controller) controller.abort(); // only one answer streams at a time
            const ctl = new AbortController();
            controller = ctl;
            let detach = () => {};
            if (signal) {
                if (signal.aborted) ctl.abort();
                else {
                    const onAbort = () => ctl.abort();
                    signal.addEventListener('abort', onAbort, { once: true });
                    detach = () => signal.removeEventListener('abort', onAbort);
                }
            }

            const useModel = model || cfg.model;
            const body = {
                model: useModel,
                stream: true,
                options: Object.assign({ num_ctx: cfg.num_ctx, temperature: cfg.temperature, num_predict: cfg.num_predict }, gen),
                messages
            };
            if (cfg.think !== undefined) body.think = cfg.think;

            const filter = cfg.stripThink === false ? null : makeThinkFilter();
            let full = '';
            let info = null;
            let finished = false;
            const emit = piece => { full += piece; if (onToken) onToken(piece); };

            try {
                let res;
                try {
                    res = await doFetch(base() + '/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        signal: ctl.signal,
                        credentials: 'omit',          // never send cookies
                        cache: 'no-store',
                        referrerPolicy: 'no-referrer'
                    });
                } catch (e) {
                    if (e && e.name === 'NeiraAIError') throw e;
                    if (isAbort(e) || ctl.signal.aborted) throw aiError('aborted', 'Generation cancelled.');
                    throw (await diagnoseNetwork()) === 'cors' ? corsBlocked(e) : notRunning(e);
                }

                if (!res.ok) {
                    let msg = '';
                    try {
                        const t = await res.text();
                        try { msg = JSON.parse(t).error || t; } catch (_) { msg = t; }
                    } catch (_) { /* ignore */ }
                    if (res.status === 404 || /not found/i.test(msg)) throw modelMissing(useModel);
                    if (res.status === 403) throw corsBlocked();
                    throw aiError('http_error', `Ollama returned HTTP ${res.status}${msg ? ': ' + clean(msg).slice(0, 200) : ''}.`, { status: res.status });
                }
                if (!res.body || typeof res.body.getReader !== 'function') throw aiError('unsupported', 'This environment cannot read streamed responses.');

                // Ollama streams newline-delimited JSON: one object per line.
                const handleLine = line => {
                    let j;
                    try { j = JSON.parse(line); } catch (_) { return; }
                    if (j.error) {
                        if (/not found/i.test(String(j.error))) throw modelMissing(useModel);
                        throw aiError('stream_error', 'Ollama reported an error: ' + clean(j.error).slice(0, 200));
                    }
                    const chunk = j.message && j.message.content;
                    if (chunk) {
                        const out = filter ? filter.push(chunk) : chunk;
                        if (out) emit(out);
                    }
                    if (j.done) { info = Object.assign({}, j); delete info.message; delete info.context; }
                };

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    let nl;
                    while ((nl = buf.indexOf('\n')) >= 0) {
                        const line = buf.slice(0, nl).trim();
                        buf = buf.slice(nl + 1);
                        if (line) handleLine(line);
                    }
                }
                buf += decoder.decode();
                if (buf.trim()) handleLine(buf.trim());
                const tail = filter ? filter.flush() : '';
                if (tail) emit(tail);

                finished = true;
                if (onDone) onDone(full, info);
                return full;
            } catch (e) {
                if (e && e.name === 'NeiraAIError') { e.partial = full; throw e; }
                if (isAbort(e) || ctl.signal.aborted) throw aiError('aborted', 'Generation cancelled.', { partial: full });
                throw aiError('network', 'The connection to Ollama was lost: ' + clean(e && e.message).slice(0, 160), { partial: full, cause: e });
            } finally {
                detach();
                if (!finished) { try { ctl.abort(); } catch (_) { /* ignore */ } } // release the connection on any failure
                if (controller === ctl) controller = null;
            }
        }

        function abort() { if (controller) controller.abort(); }
        function isStreaming() { return controller !== null; }
        function getConfig() { return { baseUrl: base(), model: cfg.model, num_ctx: cfg.num_ctx, temperature: cfg.temperature, num_predict: cfg.num_predict }; }

        // Is Ollama reachable, and is the configured model installed? Never throws.
        async function ping() {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 3000);
            try {
                const res = await doFetch(base() + '/api/tags', { signal: ctl.signal, credentials: 'omit', cache: 'no-store' });
                if (!res.ok) return { available: false, reason: res.status === 403 ? 'cors' : 'http_error', status: res.status };
                const data = await res.json();
                const names = (data.models || []).map(m => m.name || m.model).filter(Boolean);
                const want = cfg.model;
                const modelInstalled = names.includes(want) || (!want.includes(':') && names.includes(want + ':latest'));
                return { available: true, modelInstalled, models: names };
            } catch (e) {
                return { available: false, reason: await diagnoseNetwork() };
            } finally {
                clearTimeout(timer);
            }
        }

        return { chat, abort, isStreaming, ping, getConfig };
    }

    // ------------------------------------------------------------------
    // AI-backed versions of analyze / answer / summarizeSelection
    // ------------------------------------------------------------------
    const MAX_SELECTION_CHARS = 8000;

    // Page text is untrusted: stop it from closing the """ fences around it.
    const fence = s => String(s).replace(/"""/g, '" " "');

    function pagePrompt(context, question) {
        return 'PAGE CONTEXT:\n"""\n' + fence(context) + '\n"""\n\n' +
            'USER QUESTION:\n' + question + '\n\n' +
            'Answer using only the page context where possible. If the page does not contain the answer, say: “I couldn’t find that on this page.”';
    }

    function selectionPrompt(selection, excerpt, request) {
        let p = 'SELECTED TEXT:\n"""\n' + fence(selection) + '\n"""\n\n';
        if (excerpt) p += 'SURROUNDING PAGE CONTEXT:\n"""\n' + fence(excerpt) + '\n"""\n\n';
        return p + 'USER REQUEST:\n' + request;
    }

    function pageStats(d) {
        const words = wordCount(d);
        return { words, minutes: Math.max(1, Math.round(words / 220)), links: d.counts.links, images: d.counts.images, kind: classify(d) };
    }

    const getClient = options => options.client
    || (options.provider === 'groq' ? createGroqClient(options.groq || options) : createOllamaClient(options.ollama || options));

    // Keeps the prompt inside num_ctx (Ollama silently drops the START of an over-long prompt, system prompt included).
    function resolveMaxChars(options, client) {
        const cfg = client.getConfig();
        const limit = Math.max(1000, Math.floor((cfg.num_ctx - cfg.num_predict - 800) * 2.5));
        return Math.min(Math.max(500, Number(options.maxChars) || CONTEXT_DEFAULT_CHARS), limit);
    }

    function needPage(d) {
        if (!d || !Array.isArray(d.sections)) throw aiError('bad_request', 'No page data was provided (run collectPage() first).');
    }

    // Sends one system+user prompt, streams tokens, then converts the finished Markdown to blocks.
    async function runAI(head, prompt, meta, client, options, callbacks) {
        if (callbacks.onStart) callbacks.onStart({ contextInfo: meta });
        let info = null;
        const gen = {};
        for (const k of ['num_ctx', 'temperature', 'num_predict']) if (options[k] !== undefined) gen[k] = options[k];
        let soFar = '';
        const text = await client.chat({
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
            model: options.model,
            options: gen,
            signal: options.signal,
            onToken: chunk => { soFar += chunk; if (callbacks.onToken) callbacks.onToken(chunk, soFar); },
            onDone: (_full, i) => { info = i; }
        });
        const reply = String(text || '').trim();
        if (!reply) throw aiError('empty_response', 'The model returned an empty reply. Try again or ask in a different way.');
        const result = Object.assign({}, head, {
            blocks: parseMarkdown(reply),
            text: reply,
            ai: true,
            model: options.model || client.getConfig().model,
            contextInfo: meta,
            finishReason: (info && info.done_reason) || ''   // 'length' means the answer hit num_predict
        });
        if (callbacks.onDone) callbacks.onDone(result);
        return result;
    }

    // Overview of the whole page.
    // options:   { client | baseUrl, model, num_ctx, temperature, num_predict, maxChars, signal }
    // callbacks: { onStart({contextInfo}), onToken(chunk, textSoFar), onDone(result) }
    // resolves:  { kind, blocks, stats, text, ai:true, model, contextInfo, finishReason }
    async function analyzeWithAI(pageData, options, callbacks) {
        options = options || {};
        callbacks = callbacks || {};
        needPage(pageData);
        const client = getClient(options);
        const ctx = buildContext(pageData, { maxChars: resolveMaxChars(options, client) });
        const meta = { originalChars: ctx.originalChars, sentChars: ctx.sentChars, truncated: ctx.truncated };
        const prompt = pagePrompt(ctx.context, 'Give a concise overview of this page: what it is, what it contains, and the key takeaways.');
        return runAI({ kind: classify(pageData), stats: pageStats(pageData) }, prompt, meta, client, options, callbacks);
    }

    // A question about the page. If options.selection is set, the selected text is the focus and
    // only a short excerpt around it is added. Other options as in analyzeWithAI, plus
    // { selection, excerptChars }.
    async function answerWithAI(question, pageData, options, callbacks) {
        options = options || {};
        callbacks = callbacks || {};
        const q = clean(question);
        if (!q) throw aiError('bad_request', 'Ask a question first.');
        const client = getClient(options);
        const selRaw = String(options.selection || '').trim();

        if (selRaw) {
            const limit = options.maxSelectionChars || MAX_SELECTION_CHARS;
            const selTruncated = selRaw.length > limit;
            const sel = selTruncated ? selRaw.slice(0, limit) + '\n[…selection truncated…]' : selRaw;
            const excerpt = pageData && selRaw.length < 4000 ? selectionExcerpt(pageData, selRaw, options.excerptChars || 2500) : '';
            const meta = { originalChars: selRaw.length, sentChars: sel.length + excerpt.length, truncated: selTruncated, selection: true };
            const head = { kind: 'selection', stats: { words: clean(selRaw).split(/\s+/).filter(Boolean).length } };
            return runAI(head, selectionPrompt(sel, excerpt, q), meta, client, options, callbacks);
        }

        needPage(pageData);
        const ctx = buildContext(pageData, { maxChars: resolveMaxChars(options, client), question: q });
        const meta = { originalChars: ctx.originalChars, sentChars: ctx.sentChars, truncated: ctx.truncated };
        return runAI({ stats: {} }, pagePrompt(ctx.context, q), meta, client, options, callbacks);
    }

    // Summary (or another request, via options.question) about selected text.
    // Pass options.pageData to add a short excerpt around the selection when that helps.
    async function summarizeSelectionWithAI(selection, options, callbacks) {
        options = options || {};
        callbacks = callbacks || {};
        const selRaw = String(selection || '').trim();
        if (!selRaw) throw aiError('bad_request', 'No text is selected.');
        const client = getClient(options);
        const limit = options.maxSelectionChars || MAX_SELECTION_CHARS;
        const selTruncated = selRaw.length > limit;
        const sel = selTruncated ? selRaw.slice(0, limit) + '\n[…selection truncated…]' : selRaw;
        const d = options.pageData;
        const excerpt = d && Array.isArray(d.sections) && selRaw.length < 4000 ? selectionExcerpt(d, selRaw, options.excerptChars || 2500) : '';
        const meta = { originalChars: selRaw.length, sentChars: sel.length + excerpt.length, truncated: selTruncated, selection: true };
        const request = clean(options.question) || 'Summarize the selected text.';
        const head = { kind: 'selection', stats: { words: clean(selRaw).split(/\s+/).filter(Boolean).length } };
        return runAI(head, selectionPrompt(sel, excerpt, request), meta, client, options, callbacks);
    }

    const api = {
        // existing
        pageContext, collectPage, classify, analyze, summarizeSelection, answer, parseMarkdown, inlineParts, blocksToText, splitSentences, pickTop, trim, wordCount,
        // optional AI mode
        createOllamaClient, createGroqClient, analyzeWithAI, answerWithAI, summarizeSelectionWithAI,
        buildPageContext: buildContext, SYSTEM_PROMPT, OLLAMA_DEFAULTS
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.NeiraAssistant = api;
})(typeof window !== 'undefined' ? window : globalThis);