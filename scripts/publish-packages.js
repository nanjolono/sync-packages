const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const ora = require('ora')
const chalk = require('chalk')

// 配置
const config = {
  packagesDir: path.join(__dirname, '../npm-packages'),
  privateRegistry: '', // 修改为你的私服地址
  auth: {
    username: '', // 账号
    password: '', // 密码
    email: '' // 邮箱
  },
  concurrency: 3,
  retries: 3
}

// 统计对象
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  failedPackages: [],
  skippedPackages: []
}

// 创建临时 .npmrc 文件
const createNpmrc = () => {
  const npmrcPath = path.join(__dirname, '../.npmrc')

  // 获取 registry 的主机名
  const registryUrl = new URL(config.privateRegistry)
  const registryHost = registryUrl.host

  // 生成 base64 格式的认证信息
  const authString = Buffer.from(`${config.auth.username}:${config.auth.password}`).toString('base64')

  const npmrcContent = `
registry=${config.privateRegistry}
${registryHost}/:_authToken=${authString}
${registryHost}/:username=${config.auth.username}
${registryHost}/:email=${config.auth.email}
${registryHost}/:always-auth=true
  `.trim()

  fs.writeFileSync(npmrcPath, npmrcContent)
  console.log(chalk.gray('Created temporary .npmrc file'))
  return npmrcPath
}

// 删除临时 .npmrc 文件
const removeNpmrc = (npmrcPath) => {
  try {
    if (fs.existsSync(npmrcPath)) {
      fs.unlinkSync(npmrcPath)
      console.log(chalk.gray('Cleaned up temporary .npmrc file'))
    }
  } catch (error) {
    console.warn(chalk.yellow('Warning: Failed to remove temporary .npmrc file:', error.message))
  }
}

// 检查包是否已存在于私服
const checkPackageExists = (packagePath) => {
  try {
    const packageName = execSync(`npm pack --json ${packagePath} | jq -r '.[0].name'`, {
      stdio: ['pipe', 'pipe', 'ignore']
    }).toString().trim()
    const packageVersion = execSync(`npm pack --json ${packagePath} | jq -r '.[0].version'`, {
      stdio: ['pipe', 'pipe', 'ignore']
    }).toString().trim()

    execSync(`npm view ${packageName}@${packageVersion} --registry=${config.privateRegistry}`, {
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

// 发布单个包
const publishPackage = async (packagePath, npmrcPath, retry = 0) => {
  const fileName = path.basename(packagePath)
  if(retry == 0) {
    // 防止失败重试时增加总数
    stats.total++
  }
  const spinner = ora(`Publishing ${fileName}...`).start()

  try {
    // 检查是否已存在
    if (checkPackageExists(packagePath)) {
      spinner.info(chalk.blue(`${fileName} already exists in private registry`))
      stats.skipped++
      stats.skippedPackages.push(fileName)
      return
    }

    // 发布到私服
    execSync(`npm publish ${packagePath} --registry=${config.privateRegistry}`, {
      stdio: 'ignore',
      env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrcPath }
    })

    spinner.succeed(chalk.green(`Successfully published ${fileName}`))
    stats.success++
  } catch (error) {
    if (retry < config.retries) {
      spinner.warn(chalk.yellow(`Retrying ${fileName} (${retry + 1}/${config.retries})`))
      return publishPackage(packagePath, npmrcPath, retry + 1)
    }
    spinner.fail(chalk.red(`Failed to publish ${fileName}: ${error.message}`))
    stats.failed++
    stats.failedPackages.push(fileName)
  }
}

// 并发控制
const publishPackagesWithConcurrency = async (packagePaths, npmrcPath) => {
  const chunks = []
  for (let i = 0; i < packagePaths.length; i += config.concurrency) {
    chunks.push(packagePaths.slice(i, i + config.concurrency))
  }

  for (const chunk of chunks) {
    await Promise.all(chunk.map(path => publishPackage(path, npmrcPath)))
  }
}

// 打印统计信息
const printStats = () => {
  console.log('\n' + chalk.blue('Publication Statistics:'))
  console.log(chalk.blue('='.repeat(50)))
  console.log(chalk.white(`Total packages processed: ${stats.total}`))
  console.log(chalk.green(`Successfully published: ${stats.success}`))
  console.log(chalk.yellow(`Skipped (already in registry): ${stats.skipped}`))
  console.log(chalk.red(`Failed to publish: ${stats.failed}`))

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
  const statsFile = path.join(__dirname, '../publish-stats.json')
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
  console.log(chalk.blue('Starting package publication...'))
  console.log(chalk.gray(`Private registry: ${config.privateRegistry}`))

  // 创建临时 .npmrc
  const npmrcPath = createNpmrc()

  try {
    // 获取所有 .tgz 文件
    const packageFiles = fs.readdirSync(config.packagesDir)
      .filter(file => file.endsWith('.tgz'))
      .map(file => path.join(config.packagesDir, file))

    if (packageFiles.length === 0) {
      console.log(chalk.yellow('No .tgz files found in the packages directory'))
      return
    }

    console.log(chalk.blue(`Found ${packageFiles.length} packages to publish`))

    await publishPackagesWithConcurrency(packageFiles, npmrcPath)
  } catch (error) {
    console.error(chalk.red('Error:', error.message))
  } finally {
    printStats()
    // 清理临时 .npmrc
    removeNpmrc(npmrcPath)
  }

  console.log(chalk.green('\nPackage publication completed!'))
}

main().catch(console.error)