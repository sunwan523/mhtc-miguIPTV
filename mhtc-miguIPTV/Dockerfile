FROM node:20-alpine

WORKDIR /app

# 复制项目文件
COPY package.json ./
COPY app.js ./
COPY public ./public

# 创建数据持久化目录
RUN mkdir -p /app/data

# 端口
EXPOSE 45678

# 数据卷（数据源配置持久化）
VOLUME ["/app/data"]

# 启动
CMD ["node", "app.js"]
