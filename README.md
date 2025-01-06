# NPM Package Manager

一个简单的同步到私库的工具。

## 功能特点

- 🚀 批量同步 npm 包到私有仓库
- 🔍 自动检查私有仓库中已存在的包
- 📦 支持依赖包及其子依赖的同步
- 🔄 断点续传，支持失败重试
- 🔒 支持私有仓库认证

## 使用方法

### 1. 配置私服信息，地址账号密码等, `list-registry-packages.js`和`publish-packages.js`

### 2. 配置所需要同步的依赖

把依赖填入在 `package.json` 的`dependencies`中：

```json
{
  "dependencies": {
    "lodash": "^4.17.21",
    "axios": "^1.6.0"
    // ... 其他需要同步的依赖
  }
}
```

### 3. 切换至内网获取私服包信息，可以跳过，但建议执行

```bash
# 获取私服已存在的包信息
npm run check-registry
```

这一步会生成 `registry-packages.json` 文件，记录私服中已经存在的包信息，避免重复下载。

### 4. 切换至外网下载包

```bash
# 确保成功下载依赖并生成package-lock.json
npm install
```

```bash
# 下载 .tgz
npm run download-packages
```

### 5. 切换至内网发布包

```bash
# 发布所有包
npm run publish-packages
```

## 注意事项

1. 重复使用时建议清理`node_modules`、`package-lock.json`、`npm-packages`
2. 使用此工具时把node和npm版本设为你项目本身所需的版本，确保下载下来的依赖可以正常使用
3. `package.json`的`devDependencies`里的三个依赖不要删除，如果这里有版本兼容问题可以修改成正确的版本
