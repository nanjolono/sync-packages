const fs = require('fs')
const path = require('path')
const axios = require('axios')
const chalk = require('chalk')

// 配置
const config = {
  privateRegistry: '', // 修改为你的私服地址
  outputFile: path.join(__dirname, '../registry-packages.json'),
  includeVersions: true,
  auth: {
    username: '', // 如果需要认证填入你的账号
    password: '' // 密码
  }
}

// 创建 axios 实例
const api = axios.create({
  baseURL: config.privateRegistry,
  auth: config.auth,
  timeout: 30000
})

// 获取所有包列表
const getAllPackages = async () => {
  try {
    console.log(chalk.blue('Fetching packages from registry...'))

    // 访问 /-/all 端点获取所有包
    const response = await api.get('/-/all')
    const packages = response.data

    // 删除 _updated 字段
    delete packages._updated

    return packages
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // 如果 /-/all 不可用，尝试使用 /-/v1/search
      try {
        const response = await api.get('/-/v1/search', {
          params: {
            text: '',
            size: 250
          }
        })
        return response.data.objects.reduce((acc, obj) => {
          acc[obj.package.name] = obj.package
          return acc
        }, {})
      } catch (searchError) {
        console.error(chalk.red('Error searching packages:', searchError.message))
        return {}
      }
    }
    console.error(chalk.red('Error fetching packages:', error.message))
    return {}
  }
}

// 获取包的详细信息
const getPackageDetails = async (packageName) => {
  try {
    const response = await api.get(`/${encodeURIComponent(packageName)}`)
    return response.data
  } catch (error) {
    console.warn(chalk.yellow(`Warning: Could not get details for ${packageName}`))
    return null
  }
}

// 主函数
const main = async () => {
  console.log(chalk.blue('Checking packages in private registry...'))
  console.log(chalk.gray(`Registry: ${config.privateRegistry}`))

  // 获取所有包
  const packages = await getAllPackages()
  const packageNames = Object.keys(packages)
  console.log(chalk.blue(`Found ${packageNames.length} packages in registry`))

  // 存储结果
  const registryInfo = {}

  // 获取每个包的详细信息
  for (let i = 0; i < packageNames.length; i++) {
    const name = packageNames[i]
    process.stdout.write(chalk.yellow(`Checking ${name} (${i + 1}/${packageNames.length})... `))

    const details = await getPackageDetails(name)

    if (details) {
      registryInfo[name] = {
        name: name,
        versions: config.includeVersions ? Object.keys(details.versions || {}) : [],
        latestVersion: details['dist-tags'] && details['dist-tags'].latest,
        description: details.description || '',
        maintainers: details.maintainers || [],
        time: details.time || {},
        license: details.license || ''
      }
      process.stdout.write(chalk.green('✓\n'))
    } else {
      registryInfo[name] = {
        name: name,
        versions: [],
        error: 'Failed to fetch details'
      }
      process.stdout.write(chalk.red('✗\n'))
    }

    // 每 10 个包保存一次结果，避免数据丢失
    if (i % 10 === 0) {
      fs.writeFileSync(
        config.outputFile,
        JSON.stringify(registryInfo, null, 2)
      )
    }
  }

  // 最终保存结果
  fs.writeFileSync(
    config.outputFile,
    JSON.stringify(registryInfo, null, 2)
  )

  // 输出统计
  const successCount = Object.values(registryInfo).filter(p => p.versions.length > 0).length
  const errorCount = Object.values(registryInfo).filter(p => p.error).length

  console.log('\nSummary:')
  console.log(chalk.green(`  ✓ ${successCount} packages fetched successfully`))
  console.log(chalk.red(`  ✗ ${errorCount} packages failed to fetch`))

  const totalVersions = Object.values(registryInfo)
    .reduce((sum, pkg) => sum + (pkg.versions ? pkg.versions.length : 0), 0)
  console.log(chalk.blue(`\nTotal versions across all packages: ${totalVersions}`))
  console.log(chalk.blue(`\nDetailed information saved to: ${config.outputFile}`))
}

// 添加搜索功能
const searchPackages = async (searchTerm) => {
  try {
    const response = await api.get('/-/v1/search', {
      params: {
        text: searchTerm,
        size: 100
      }
    })
    return response.data.objects.map(obj => obj.package)
  } catch (error) {
    console.error(chalk.red(`Error searching for ${searchTerm}:`, error.message))
    return []
  }
}

// 处理命令行参数
const handleArgs = async () => {
  const args = process.argv.slice(2)
  if (args.length > 0) {
    const searchTerm = args[0]
    console.log(chalk.blue(`Searching for packages matching "${searchTerm}"...`))
    const results = await searchPackages(searchTerm)
    console.log(JSON.stringify(results, null, 2))
    process.exit(0)
  }
}

// 运行程序
const run = async () => {
  try {
    await handleArgs()
    await main()
  } catch (error) {
    console.error(chalk.red('Fatal error:', error))
    process.exit(1)
  }
}

run()