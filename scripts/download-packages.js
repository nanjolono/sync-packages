const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const chalk = require('chalk')

// 配置
const config = {
  downloadDir: path.join(__dirname, '../npm-packages'),
  tempDir: path.join(__dirname, '../temp-download'),
  registryInfoFile: path.join(__dirname, '../registry-packages.json'),
  concurrency: 5,
  retries: 3
}

// 统计对象
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  failedPackages: [], // 记录失败的包
  skippedPackages: [], // 记录跳过的包
}

// 读取私服包信息
const getRegistryInfo = () => {
  try {
    if (fs.existsSync(config.registryInfoFile)) {
      return JSON.parse(fs.readFileSync(config.registryInfoFile, 'utf-8'))
    }
  } catch (error) {
    console.warn(chalk.yellow('Warning: Could not read registry info file'))
  }
  return {}
}

// 从 package-lock.json 读取所有依赖
const getDependenciesFromLock = () => {
  try {
    // 检查 package-lock.json 是否存在
    const lockPath = path.join(__dirname, '../package-lock.json')
    if (!fs.existsSync(lockPath)) {
      throw new Error('package-lock.json not found! Please run npm install first.')
    }

    const lockFile = require(lockPath)
    const dependencies = new Map()

    // 处理 npm v7+ 的 package-lock.json 格式
    if (lockFile.packages) {
      // 遍历所有包
      Object.entries(lockFile.packages).forEach(([pkgPath, info]) => {
        // 跳过根包
        if (pkgPath === '' || !info) return

        // 从路径中提取包名和版本
        // node_modules/package-name 或 node_modules/@scope/package-name
        const parts = pkgPath.replace('node_modules/', '').split('/')
        let name, version

        if (parts[0].startsWith('@')) {
          // 处理 scoped 包
          name = parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]
          version = info.version
        } else {
          name = parts[0]
          version = info.version
        }

        if (name && version) {
          dependencies.set(`${name}@${version}`, {
            name,
            version,
            resolved: info.resolved || `https://registry.npmjs.org/${name}/-/${name.replace('@', '').replace('/', '-')}-${version}.tgz`
          })
        }
      })
    }
    // 处理旧版本的 package-lock.json 格式
    else if (lockFile.dependencies) {
      const extractDeps = (deps) => {
        Object.entries(deps).forEach(([name, info]) => {
          if (info && info.version) {
            dependencies.set(`${name}@${info.version}`, {
              name,
              version: info.version,
              resolved: info.resolved || `https://registry.npmjs.org/${name}/-/${name.replace('@', '').replace('/', '-')}-${info.version}.tgz`
            })
          }
          if (info && info.dependencies) {
            extractDeps(info.dependencies)
          }
        })
      }

      extractDeps(lockFile.dependencies)
    }

    return Array.from(dependencies.values())
  } catch (error) {
    console.error(chalk.red('Error reading package-lock.json:', error.message))
    process.exit(1)
  }
}

// 下载单个包
const downloadPackage = async (pkg, registryInfo, retry = 0) => {
  const { name, version, resolved } = pkg
  stats.total++
  const pkgInfo = registryInfo[name]

  // console.log(chalk.gray(`检查包 ${name}@${version} 在私有仓库中的状态:`))
  // console.log(chalk.gray(`- 包信息: ${pkgInfo ? '存在' : '不存在'}`))
  // if (pkgInfo) {
  //   console.log(chalk.gray(`- 可用版本: ${pkgInfo.versions ? pkgInfo.versions.join(', ') : '无'}`))
  //   console.log(chalk.gray(`- 版本匹配: ${pkgInfo.versions && pkgInfo.versions.includes(version)}`))
  // }

  if (pkgInfo && pkgInfo.versions && pkgInfo.versions.includes(version)) {
    console.log(chalk.gray(`Skipping ${name}@${version} (already exists in private registry)`))
    stats.skipped++
    stats.skippedPackages.push(`${name}@${version}`)
    return true
  }
  console.log(chalk.blue(`Downloading ${name}@${version}...`))

  try {
    // 创建下载目录
    if (!fs.existsSync(config.downloadDir)) {
      fs.mkdirSync(config.downloadDir, { recursive: true })
    }

    // 如果有 resolved URL，直接从该 URL 下载
    if (resolved) {
      const filename = resolved.split('/').pop()
      const outputPath = path.join(config.downloadDir, filename)

      // 使用 curl 下载（Windows 上可能需要替换为其他命令）
      execSync(`curl -L "${resolved}" -o "${outputPath}"`, {
        stdio: ['pipe', 'pipe', 'inherit']
      })
    } else {
      // 如果没有 resolved URL，使用 npm pack
      execSync(`npm pack ${name}@${version} --ignore-scripts`, {
        cwd: config.downloadDir,
        stdio: ['pipe', 'pipe', 'inherit']
      })
    }

    console.log(chalk.green(`Successfully downloaded ${name}@${version}`))
    stats.success++
    return true
  } catch (error) {
    if (retry < config.retries) {
      console.log(chalk.yellow(`Retrying ${name}@${version} (${retry + 1}/${config.retries})`))
      return downloadPackage(pkg, registryInfo, retry + 1)
    }
    console.log(chalk.red(`Failed to download ${name}@${version}: ${error.message}`))
    stats.failed++
    stats.failedPackages.push(`${name}@${version}`)
    return false
  }
}

// 并发控制
const downloadPackagesWithConcurrency = async (packages, registryInfo) => {
  const chunks = []
  for (let i = 0; i < packages.length; i += config.concurrency) {
    chunks.push(packages.slice(i, i + config.concurrency))
  }

  const results = []
  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map(pkg => downloadPackage(pkg, registryInfo)))
    results.push(...chunkResults)
  }

  return results.every(Boolean)
}

// 打印统计信息
const printStats = () => {
  console.log('\n' + chalk.blue('Download Statistics:'))
  console.log(chalk.blue('='.repeat(50)))
  console.log(chalk.white(`Total packages processed: ${stats.total}`))
  console.log(chalk.green(`Successfully downloaded: ${stats.success}`))
  console.log(chalk.yellow(`Skipped (already in registry): ${stats.skipped}`))
  console.log(chalk.red(`Failed to download: ${stats.failed}`))

  if (stats.failedPackages.length > 0) {
    console.log('\n' + chalk.red('Failed packages:'))
    stats.failedPackages.forEach(pkg => {
      console.log(chalk.red(`  - ${pkg}`))
    })
  }

  if (stats.skippedPackages.length > 0) {
    console.log('\n' + chalk.yellow('Skipped packages:'))
    stats.skippedPackages.forEach(pkg => {
      console.log(chalk.yellow(`  - ${pkg}`))
    })
  }

  // 保存统计信息到文件
  const statsFile = path.join(__dirname, '../download-stats.json')
  fs.writeFileSync(statsFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    stats: {
      total: stats.total,
      success: stats.success,
      failed: stats.failed,
      skipped: stats.skipped,
      failedPackages: stats.failedPackages,
      skippedPackages: stats.skippedPackages
    }
  }, null, 2))
  console.log(chalk.blue(`\nDetailed statistics saved to: ${statsFile}`))
}

// 主函数
const main = async () => {
  console.log(chalk.blue('Starting package download...'))

  // 获取所有依赖
  const dependencies = getDependenciesFromLock()
  console.log(chalk.blue(`Found ${dependencies.length} packages to download`))

  if (dependencies.length === 0) {
    console.log(chalk.yellow('No dependencies found!'))
    return
  }

  // 显示所有将要下载的包
  console.log(chalk.gray('\nPackages to download:'))
  dependencies.forEach(dep => {
    console.log(chalk.gray(`- ${dep.name}@${dep.version}`))
  })

  console.log('') // 空行
  const registryInfo = getRegistryInfo()
  const success = await downloadPackagesWithConcurrency(dependencies, registryInfo)

  if (success) {
    console.log(chalk.green('\nAll packages downloaded successfully!'))
  } else {
    console.log(chalk.yellow('\nSome packages failed to download.'))
  }
  printStats()
  console.log(chalk.blue(`Packages are saved in: ${config.downloadDir}`))
}

// 检查是否安装了必要的工具
const checkRequirements = () => {
  try {
    // 检查 curl 是否可用
    execSync('curl --version', { stdio: 'ignore' })
  } catch (error) {
    console.error(chalk.red('Error: curl is required but not found.'))
    process.exit(1)
  }
}

// 运行主程序
checkRequirements()
main().catch(error => {
  console.error(chalk.red('Fatal error:', error))
  process.exit(1)
})