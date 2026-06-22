# 全网热点监控中心 - 部署指南

## 项目结构

```
hot-monitor-app/
├── server.js          # Node.js 后端（抓取各平台热搜API）
├── package.json       # 依赖配置
├── public/
│   └── index.html     # 前端页面（自动检测后端，无后端时使用模拟数据）
└── DEPLOY.md          # 本文件
```

## 数据刷新机制

- **后端**：每 2 小时自动抓取一次全网热搜数据，缓存 2 分钟
- **前端**：每 5 分钟检查一次缓存数据，每 2 小时触发强制刷新，手动点击"立即刷新"也会强制拉取最新数据
- **无后端时**：前端自动 fallback 到模拟数据模式

## 支持的平台（9个真实API）

| 平台 | API状态 | 数据来源 |
|------|---------|----------|
| 微博热搜 | ✅ | weibo.com/ajax/side/hotSearch |
| 百度热搜 | ✅ | top.baidu.com/api/board |
| 抖音热榜 | ✅ | aweme.snssdk.com |
| 知乎热榜 | ✅ | zhihu.com/api/v3 |
| 今日头条 | ✅ | toutiao.com/hot-event |
| B站热门 | ✅ | api.bilibili.com |
| 腾讯新闻 | ✅ | r.inews.qq.com |
| 澎湃新闻 | ✅ | thepaper.cn/contentapi |
| 掘金热榜 | ✅ | api.juejin.cn |

---

## 方案一：OA Pages 部署（推荐，司内使用）

### 步骤

1. **本地测试**
   ```bash
   cd hot-monitor-app
   npm install
   node server.js
   # 访问 http://localhost:3000
   ```

2. **部署到 OA Pages**
   - 将 `public/index.html` 上传到 OA Pages
   - 此方式为静态部署，使用模拟数据
   - 适合快速分享给同事查看

---

## 方案二：服务器部署（推荐，真实数据）

### 选项 A：腾讯云轻量应用服务器

```bash
# 1. 登录服务器
ssh root@your-server-ip

# 2. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. 上传项目
scp -r hot-monitor-app/ root@your-server-ip:~/

# 4. 安装依赖
cd ~/hot-monitor-app && npm install

# 5. 使用 PM2 守护进程运行
npm install -g pm2
pm2 start server.js --name hot-monitor
pm2 startup  # 设置开机自启
pm2 save
```

### 选项 B：Docker 部署

创建 `Dockerfile`:
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t hot-monitor .
docker run -d --name hot-monitor -p 3000:3000 --restart always hot-monitor
```

### 选项 C：腾讯云函数 SCF（Serverless）

适合低成本运行，按调用次数计费：
1. 将 `server.js` 改造为云函数入口
2. 通过定时触发器每 2 小时抓取数据存入 COS
3. 前端从 COS 读取 JSON 数据

---

## 方案三：Vercel / Railway 一键部署（外网访问）

### Vercel 部署

```bash
# 安装 Vercel CLI
npm i -g vercel

# 在项目目录执行
vercel
# 按提示操作即可
```

### Railway 部署

1. 访问 https://railway.app
2. 连接 GitHub 仓库
3. 自动检测 Node.js 项目并部署
4. 免费额度每月 500 小时

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/hot` | GET | 获取全网热搜数据 |
| `/api/hot?refresh=1` | GET | 强制刷新数据 |
| `/api/health` | GET | 健康检查 |
