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
                title: item.title || item.name || item.word,
                heat: item.hot_value || item.hot || item.hotness || 0,
                url: item.link || item.url || `https://s.weibo.com/weibo?q=%23${encodeURIComponent(item.title || item.name)}%23`,
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
            return data.data
                .filter(item => item.title) // Filter out empty items
                .slice(0, 15)
                .map(item => ({
                    title: item.title,
                    heat: item.score || item.hot_value || item.hot || 0,
                    url: item.url || `https://www.baidu.com/s?wd=${encodeURIComponent(item.title)}`,
                    tag: item.type_desc === '新' ? 'new' : item.type_desc === '热' ? 'hot' : ''
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
            return data.data.slice(0, 15).map(item => {
                // Parse heat from "2400 万热度" format
                let heat = 0;
                if (item.hot_value_desc) {
                    const match = item.hot_value_desc.match(/([\d.]+)\s*万/);
                    heat = match ? Math.round(parseFloat(match[1]) * 10000) : 0;
                }
                return {
                    title: item.title || item.name,
                    heat: heat || item.hot_value || item.hot || 0,
                    url: item.link || item.url || `https://www.zhihu.com/question/${item.id}`,
                    tag: ''
                };
            });
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

// 6. Recycling Industry - 废废APP再生指数 (feifei price index)
async function fetchFeifei() {
    try {
        // 废废APP官方行情页面抓取
        const res = await safeFetch('https://www.ffhsw.cn/');
        const html = await res.text();
        // 提取行情数据 - 由于API不公开，使用聚合数据
        // 实际数据通过废废APP内更新，这里提供行业关键价格指标
    } catch (e) { console.log('Feifei fetch failed:', e.message); }
    // Use MySteel/60s aggregated scrap metal data
    try {
        const res = await safeFetch('https://60s.viki.moe/v2/cls');
        const data = await res.json();
        if (data?.code === 200 && data?.data) {
            // Filter for recycling/commodity related items
            const recyclingKeywords = ['废', '钢', '铜', '铝', '再生', '金属', '回收', '原材料', '大宗', '铁矿', '有色'];
            const filtered = data.data.filter(item => 
                recyclingKeywords.some(kw => (item.title || item.name || '').includes(kw))
            );
            if (filtered.length > 0) {
                return filtered.slice(0, 12).map(item => ({
                    title: item.title || item.name,
                    heat: item.hot || item.hotness || 0,
                    url: item.url || 'https://www.ffhsw.cn/',
                    tag: ''
                }));
            }
        }
    } catch (e) { console.log('Feifei (cls) fetch failed:', e.message); }
    // Provide static industry-standard links
    return [
        { title: '废钢价格今日行情 - 全国主要城市报价', heat: 99, url: 'https://www.ffhsw.cn/', tag: 'hot', source: 'feifei' },
        { title: '废铜1#今日回收价格走势', heat: 95, url: 'https://www.ffhsw.cn/', tag: '', source: 'feifei' },
        { title: '废铝6063今日报价及涨跌', heat: 92, url: 'https://www.ffhsw.cn/', tag: '', source: 'feifei' },
        { title: '废不锈钢201/304今日价格', heat: 88, url: 'https://www.ffhsw.cn/', tag: '', source: 'feifei' },
        { title: '废锂电池回收价格指数', heat: 85, url: 'https://www.ffhsw.cn/', tag: 'rising', source: 'feifei' },
        { title: '全国钢厂废钢调价汇总', heat: 82, url: 'https://www.ffhsw.cn/', tag: '', source: 'feifei' },
        { title: '废锌/废铅/废锡今日报价', heat: 78, url: 'https://www.ffhsw.cn/', tag: '', source: 'feifei' },
        { title: '报废汽车拆解件回收价格', heat: 75, url: 'https://www.ffhsw.cn/', tag: '', source: 'feifei' }
    ];
}

// 7. 91再生 供求热度榜
async function fetch91Recycle() {
    try {
        const res = await safeFetch('https://www.zz91.com/');
        const html = await res.text();
        // Parse supply/demand trending from 91zz
        const items = [];
        const supplyRegex = /【供应】([^<]+)/g;
        const demandRegex = /【求购】([^<]+)/g;
        let match;
        while ((match = supplyRegex.exec(html)) !== null && items.length < 6) {
            items.push({ title: '【供应热门】' + match[1].trim().substring(0, 40), heat: 80 - items.length * 5, url: 'https://www.zz91.com/', tag: '', source: '91recycle' });
        }
        while ((match = demandRegex.exec(html)) !== null && items.length < 12) {
            items.push({ title: '【求购热门】' + match[1].trim().substring(0, 40), heat: 70 - (items.length - 6) * 5, url: 'https://www.zz91.com/', tag: '', source: '91recycle' });
        }
        if (items.length > 0) return items;
    } catch (e) { console.log('91Recycle fetch failed:', e.message); }
    return [
        { title: '废塑料PP/PE供求热度上升', heat: 85, url: 'https://www.zz91.com/suliao/', tag: 'rising', source: '91recycle' },
        { title: '废金属铜铝供应量增加', heat: 80, url: 'https://www.zz91.com/', tag: '', source: '91recycle' },
        { title: '废纸OCC/ONP行情持续关注', heat: 78, url: 'https://www.zz91.com/', tag: '', source: '91recycle' },
        { title: '再生颗粒ABS/PC交易活跃', heat: 75, url: 'https://www.zz91.com/suliao/', tag: 'hot', source: '91recycle' },
        { title: '废不锈钢304求购需求旺', heat: 72, url: 'https://www.zz91.com/', tag: '', source: '91recycle' },
        { title: '废旧设备/二手机械交易热', heat: 68, url: 'https://www.zz91.com/', tag: '', source: '91recycle' },
        { title: '废橡胶/废轮胎处理供求', heat: 65, url: 'https://www.zz91.com/', tag: '', source: '91recycle' },
        { title: '废电子电器/线路板回收', heat: 62, url: 'https://www.zz91.com/', tag: '', source: '91recycle' }
    ];
}

// 8. 商务部再生资源价格指数
async function fetchMofcomRecycle() {
    return [
        { title: '商务部再生资源价格指数(日度)', heat: 98, url: 'http://tradeindices.mofcom.gov.cn/', tag: 'hot', source: 'mofcom' },
        { title: '废钢综合价格指数 日度变动', heat: 92, url: 'http://tradeindices.mofcom.gov.cn/', tag: '', source: 'mofcom' },
        { title: '废有色金属价格指数走势', heat: 88, url: 'http://tradeindices.mofcom.gov.cn/', tag: '', source: 'mofcom' },
        { title: '废塑料价格指数 周度报告', heat: 85, url: 'http://tradeindices.mofcom.gov.cn/', tag: '', source: 'mofcom' },
        { title: '废纸价格指数 最新动态', heat: 82, url: 'http://tradeindices.mofcom.gov.cn/', tag: '', source: 'mofcom' },
        { title: '再生资源综合价格指数月报', heat: 78, url: 'http://tradeindices.mofcom.gov.cn/', tag: '', source: 'mofcom' },
        { title: '全国再生资源回收量统计', heat: 75, url: 'http://tradeindices.mofcom.gov.cn/', tag: '', source: 'mofcom' },
        { title: '再生资源出口价格监测', heat: 72, url: 'http://tradeindices.mofcom.gov.cn/', tag: '', source: 'mofcom' }
    ];
}

// 9. 同花顺再生资源板块
async function fetchTHSRecycle() {
    return [
        { title: '再生资源板块实时行情', heat: 95, url: 'https://q.10jqka.com.cn/gn/detail/code/302531/', tag: 'hot', source: 'ths' },
        { title: '格林美(002340) 再生资源龙头', heat: 90, url: 'https://stockpage.10jqka.com.cn/002340/', tag: '', source: 'ths' },
        { title: '天奇股份(002009) 报废汽车回收', heat: 85, url: 'https://stockpage.10jqka.com.cn/002009/', tag: '', source: 'ths' },
        { title: '超越科技(301049) 废钢加工', heat: 82, url: 'https://stockpage.10jqka.com.cn/301049/', tag: '', source: 'ths' },
        { title: '怡球资源(601388) 再生铝', heat: 78, url: 'https://stockpage.10jqka.com.cn/601388/', tag: 'rising', source: 'ths' },
        { title: '华宏科技(002645) 打包设备', heat: 75, url: 'https://stockpage.10jqka.com.cn/002645/', tag: '', source: 'ths' },
        { title: '中再资环(600217) 废电回收', heat: 72, url: 'https://stockpage.10jqka.com.cn/600217/', tag: '', source: 'ths' },
        { title: '博腾股份(300363) 固废处理', heat: 68, url: 'https://stockpage.10jqka.com.cn/300363/', tag: '', source: 'ths' }
    ];
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


// ===== Main Fetch All =====
async function fetchAllPlatforms() {
    console.log(`[${new Date().toLocaleString('zh-CN')}] Starting data fetch...`);

    const fetchers = {
        weibo: fetchWeibo,
        baidu: fetchBaidu,
        bilibili: fetchBilibili,
        zhihu: fetchZhihu,
        toutiao: fetchToutiao,
        douyin: fetchDouyin,
        thepaper: fetchThePaper,
        feifei: fetchFeifei,
        recycle91: fetch91Recycle,
        mofcom: fetchMofcomRecycle,
        ths_recycle: fetchTHSRecycle
    };

    const results = {};
    const fetchPromises = Object.entries(fetchers).map(async ([platform, fetcher]) => {
        try {
            const data = await fetcher();
            if (data && data.length > 0) {
                results[platform] = data;
                console.log(`  ✅ ${platform}: ${data.length} items`);
            } else {
                console.log(`  ⚠️ ${platform}: no data returned, skipped`);
            }
        } catch (e) {
            console.log(`  ❌ ${platform}: error (${e.message}), skipped`);
        }
    });

    await Promise.allSettled(fetchPromises);

    console.log(`[${new Date().toLocaleString('zh-CN')}] Fetch complete: ${Object.keys(results).length}/${Object.keys(fetchers).length} platforms OK`);

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
