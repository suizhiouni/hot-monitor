const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ===== Data Cache =====
let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes cache

// ===== Platform Fetchers =====

// Helper: fetch with timeout and error handling
async function safeFetch(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/html, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                ...(options.headers || {})
            }
        });
        clearTimeout(timeout);
        return res;
    } catch (e) {
        clearTimeout(timeout);
        throw e;
    }
}

// 1. Weibo Hot Search (via 60s CDN API - global accessible)
async function fetchWeibo() {
    try {
        const res = await safeFetch('https://60s.viki.moe/v2/weibo');
        const data = await res.json();
        if (data?.code === 200 && data?.data) {
            return data.data.slice(0, 15).map((item, i) => ({
                title: item.title || item.name,
                heat: item.hot || item.hotness || 0,
                url: item.url || `https://s.weibo.com/weibo?q=%23${encodeURIComponent(item.title || item.name)}%23`,
                tag: i < 3 ? 'hot' : (item.tag === 'new' || item.isNew) ? 'new' : ''
            }));
        }
    } catch (e) { console.log('Weibo (60s) fetch failed:', e.message); }
    // Fallback: try direct API
    try {
        const res = await safeFetch('https://weibo.com/ajax/side/hotSearch');
        const data = await res.json();
        if (data?.data?.realtime) {
            return data.data.realtime.slice(0, 15).map((item, i) => ({
                title: item.note || item.word,
                heat: item.num || item.raw_hot || 0,
                url: `https://s.weibo.com/weibo?q=%23${encodeURIComponent(item.word)}%23`,
                tag: item.is_new ? 'new' : item.is_hot ? 'hot' : item.is_fei ? 'rising' : ''
            }));
        }
    } catch (e) { console.log('Weibo (direct) fetch failed:', e.message); }
    return null;
}

// 2. Baidu Hot Search (via 60s CDN API)
async function fetchBaidu() {
    try {
        const res = await safeFetch('https://60s.viki.moe/v2/baidu/hot');
        const data = await res.json();
        if (data?.code === 200 && data?.data) {
            return data.data.slice(0, 15).map(item => ({
                title: item.title || item.name,
                heat: item.hot || item.hotness || 0,
                url: item.url || `https://www.baidu.com/s?wd=${encodeURIComponent(item.title || item.name)}`,
                tag: ''
            }));
        }
    } catch (e) { console.log('Baidu (60s) fetch failed:', e.message); }
    // Fallback: try direct API
    try {
        const res = await safeFetch('https://top.baidu.com/api/board?platform=wise&tab=realtime');
        const data = await res.json();
        if (data?.data?.cards?.[0]?.content) {
            return data.data.cards[0].content.slice(0, 15).map(item => ({
                title: item.word || item.query,
                heat: parseInt(item.hotScore) || 0,
                url: item.url || `https://www.baidu.com/s?wd=${encodeURIComponent(item.word || item.query)}`,
                tag: item.isNew ? 'new' : item.isHot ? 'hot' : ''
            }));
        }
    } catch (e) { console.log('Baidu (direct) fetch failed:', e.message); }
    return null;
}

// 3. Bilibili Hot Search
async function fetchBilibili() {
    try {
        const res = await safeFetch('https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1');
        const data = await res.json();
        if (data?.data?.list) {
            return data.data.list.slice(0, 12).map(item => ({
                title: item.title,
                heat: item.stat?.view || 0,
                url: `https://www.bilibili.com/video/${item.bvid}`,
                tag: ''
            }));
        }
    } catch (e) { console.log('Bilibili popular fetch failed:', e.message); }
    // Fallback: trending search
    try {
        const res = await safeFetch('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all');
        const data = await res.json();
        if (data?.data?.list) {
            return data.data.list.slice(0, 12).map(item => ({
                title: item.title,
                heat: item.stat?.view || 0,
                url: `https://www.bilibili.com/video/${item.bvid}`,
                tag: ''
            }));
        }
    } catch (e) { console.log('Bilibili ranking fetch failed:', e.message); }
    return null;
}

// 4. Zhihu Hot List (via 60s CDN API)
async function fetchZhihu() {
    try {
        const res = await safeFetch('https://60s.viki.moe/v2/zhihu');
        const data = await res.json();
        if (data?.code === 200 && data?.data) {
            return data.data.slice(0, 15).map(item => ({
                title: item.title || item.name,
                heat: item.hot || item.hotness || 0,
                url: item.url || `https://www.zhihu.com/question/${item.id}`,
                tag: ''
            }));
        }
    } catch (e) { console.log('Zhihu (60s) fetch failed:', e.message); }
    // Fallback: direct API
    try {
        const res = await safeFetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=15', {
            headers: { 'Referer': 'https://www.zhihu.com/hot' }
        });
        const data = await res.json();
        if (data?.data) {
            return data.data.slice(0, 15).map(item => ({
                title: item.target?.title || item.title || '',
                heat: parseInt(item.detail_text?.replace(/[^\d]/g, '')) || 0,
                url: item.target?.url?.replace('api.zhihu.com/questions', 'www.zhihu.com/question') || `https://www.zhihu.com/question/${item.target?.id}`,
                tag: ''
            }));
        }
    } catch (e) { console.log('Zhihu (direct) fetch failed:', e.message); }
    return null;
}

// 5. Toutiao Hot Board
async function fetchToutiao() {
    try {
        const res = await safeFetch('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc');
        const data = await res.json();
        if (data?.data) {
            return data.data.slice(0, 12).map(item => ({
                title: item.Title || item.title,
                heat: parseInt(item.HotValue) || 0,
                url: item.Url || `https://www.toutiao.com/search/?keyword=${encodeURIComponent(item.Title || item.title)}`,
                tag: ''
            }));
        }
    } catch (e) { console.log('Toutiao fetch failed:', e.message); }
    return null;
}

// 6. QQ News Hot Ranking (via 60s CDN API + direct fallback)
async function fetchQQNews() {
    try {
        const res = await safeFetch('https://60s.viki.moe/v2/tencent-news');
        const data = await res.json();
        if (data?.code === 200 && data?.data) {
            return data.data.slice(0, 12).map(item => ({
                title: item.title || item.name,
                heat: item.hot || item.hotness || 0,
                url: item.url || `https://new.qq.com/`,
                tag: ''
            }));
        }
    } catch (e) { console.log('QQNews (60s) fetch failed:', e.message); }
    // Fallback: direct API
    try {
        const res = await safeFetch('https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=20');
        const data = await res.json();
        if (data?.newslist) {
            return data.newslist.slice(0, 12).map(item => ({
                title: item.title,
                heat: parseInt(item.hotEvent?.hotScore) || parseInt(item.readCount) || 0,
                url: item.url || item.surl || `https://new.qq.com/rain/a/${item.id}`,
                tag: ''
            }));
        }
    } catch (e) { console.log('QQNews (direct) fetch failed:', e.message); }
    return null;
}

// 7. Douyin Hot Search
async function fetchDouyin() {
    try {
        const res = await safeFetch('https://aweme.snssdk.com/aweme/v1/hot/search/list/');
        const data = await res.json();
        if (data?.data?.word_list) {
            return data.data.word_list.slice(0, 12).map(item => ({
                title: item.word,
                heat: item.hot_value || 0,
                url: `https://www.douyin.com/search/${encodeURIComponent(item.word)}`,
                tag: item.label === 1 ? 'new' : ''
            }));
        }
    } catch (e) { console.log('Douyin fetch failed:', e.message); }
    return null;
}

// 8. The Paper (Pengpai)
async function fetchThePaper() {
    try {
        const res = await safeFetch('https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar');
        const data = await res.json();
        if (data?.data?.hotNews) {
            return data.data.hotNews.slice(0, 10).map(item => ({
                title: item.name || item.title,
                heat: parseInt(item.praiseTimes) || 0,
                url: item.contId ? `https://www.thepaper.cn/newsDetail_forward_${item.contId}` : 'https://www.thepaper.cn/',
                tag: ''
            }));
        }
    } catch (e) { console.log('ThePaper fetch failed:', e.message); }
    return null;
}

// 9. Juejin Hot Articles (via 60s CDN API)
async function fetchJuejin() {
    try {
        const res = await safeFetch('https://60s.viki.moe/v2/juejin');
        const data = await res.json();
        if (data?.code === 200 && data?.data) {
            return data.data.slice(0, 10).map(item => ({
                title: item.title || item.name,
                heat: item.hot || item.hotness || 0,
                url: item.url || `https://juejin.cn/`,
                tag: ''
            }));
        }
    } catch (e) { console.log('Juejin (60s) fetch failed:', e.message); }
    // Fallback: direct API
    try {
        const res = await safeFetch('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data?.data) {
            return data.data.slice(0, 10).map(item => ({
                title: item.content?.title || '',
                heat: item.content_counter?.hot_rank || item.content_counter?.view || 0,
                url: `https://juejin.cn/post/${item.content?.content_id}`,
                tag: ''
            }));
        }
    } catch (e) { console.log('Juejin (direct) fetch failed:', e.message); }
    return null;
}

// ===== Fallback Data Generator =====
function generateFallbackData(platform) {
    const fallbacks = {
        weibo: [
            { title: '微博热搜加载中...', heat: 0, url: 'https://s.weibo.com/top/summary', tag: '' }
        ],
        baidu: [
            { title: '百度热搜加载中...', heat: 0, url: 'https://top.baidu.com/board', tag: '' }
        ],
        douyin: [
            { title: '抖音热榜加载中...', heat: 0, url: 'https://www.douyin.com/', tag: '' }
        ],
        zhihu: [
            { title: '知乎热榜加载中...', heat: 0, url: 'https://www.zhihu.com/hot', tag: '' }
        ],
        toutiao: [
            { title: '头条热榜加载中...', heat: 0, url: 'https://www.toutiao.com/', tag: '' }
        ],
        bilibili: [
            { title: 'B站热榜加载中...', heat: 0, url: 'https://www.bilibili.com/v/popular/all', tag: '' }
        ],
        qqnews: [
            { title: '腾讯新闻加载中...', heat: 0, url: 'https://news.qq.com/', tag: '' }
        ],
        thepaper: [
            { title: '澎湃新闻加载中...', heat: 0, url: 'https://www.thepaper.cn/', tag: '' }
        ],
        juejin: [
            { title: '掘金热榜加载中...', heat: 0, url: 'https://juejin.cn/', tag: '' }
        ]
    };
    return fallbacks[platform] || [{ title: '数据加载中...', heat: 0, url: '#', tag: '' }];
}

// ===== Main Fetch All =====
async function fetchAllPlatforms() {
    console.log(`[${new Date().toLocaleString('zh-CN')}] Starting data fetch...`);

    const fetchers = {
        weibo: fetchWeibo,
        baidu: fetchBaidu,
        bilibili: fetchBilibili,
        zhihu: fetchZhihu,
        toutiao: fetchToutiao,
        qqnews: fetchQQNews,
        douyin: fetchDouyin,
        thepaper: fetchThePaper,
        juejin: fetchJuejin
    };

    const results = {};
    const fetchPromises = Object.entries(fetchers).map(async ([platform, fetcher]) => {
        try {
            const data = await fetcher();
            results[platform] = data || generateFallbackData(platform);
            console.log(`  ✅ ${platform}: ${results[platform].length} items`);
        } catch (e) {
            results[platform] = generateFallbackData(platform);
            console.log(`  ❌ ${platform}: fallback (${e.message})`);
        }
    });

    await Promise.allSettled(fetchPromises);

    const successCount = Object.values(results).filter(v => v && v.length > 1 || (v && v[0] && v[0].title && !v[0].title.includes('加载中'))).length;
    console.log(`[${new Date().toLocaleString('zh-CN')}] Fetch complete: ${successCount}/${Object.keys(fetchers).length} platforms OK`);

    return results;
}

// ===== API Endpoints =====

// Get all hot data
app.get('/api/hot', async (req, res) => {
    const now = Date.now();
    const forceRefresh = req.query.refresh === '1';

    if (!forceRefresh && cachedData && (now - lastFetchTime) < CACHE_DURATION) {
        return res.json({
            success: true,
            data: cachedData,
            cached: true,
            lastUpdate: new Date(lastFetchTime).toISOString(),
            nextUpdate: new Date(lastFetchTime + CACHE_DURATION).toISOString()
        });
    }

    try {
        cachedData = await fetchAllPlatforms();
        lastFetchTime = Date.now();
        res.json({
            success: true,
            data: cachedData,
            cached: false,
            lastUpdate: new Date(lastFetchTime).toISOString()
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        lastFetchTime: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
        cachedPlatforms: cachedData ? Object.keys(cachedData).length : 0
    });
});

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== Background Refresh =====
const AUTO_REFRESH_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours

async function backgroundRefresh() {
    try {
        cachedData = await fetchAllPlatforms();
        lastFetchTime = Date.now();
        console.log(`[Auto-refresh] Data updated at ${new Date().toLocaleString('zh-CN')}`);
    } catch (e) {
        console.log(`[Auto-refresh] Failed: ${e.message}`);
    }
}

// ===== Start Server =====
app.listen(PORT, async () => {
    console.log(`\n🔥 全网热点监控中心 已启动`);
    console.log(`📡 访问地址: http://localhost:${PORT}`);
    console.log(`🔄 自动刷新间隔: ${AUTO_REFRESH_INTERVAL / 1000 / 60} 分钟`);
    console.log(`📊 API地址: http://localhost:${PORT}/api/hot\n`);

    // Initial fetch
    await backgroundRefresh();

    // Schedule auto-refresh
    setInterval(backgroundRefresh, AUTO_REFRESH_INTERVAL);
});
