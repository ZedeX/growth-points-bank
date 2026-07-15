# Project Memory - 暑假成长积分银行

---

## 2026-07-15 23:26 - 项目初始化

### 需求来源
用户要求根据微信公众号文章《我，不懂代码，却给俩娃量身定制了一款"暑假成长积分银行"App》（作者：魔女库伊拉）整理一个产品PRD。

- **文章链接**: https://mp.weixin.qq.com/s/rgny628l633XrJeZokrcZg
- **文章获取方式**: 使用curl抓取HTML，通过PowerShell脚本提取og:title/og:description元数据和js_content区域内容

### 用户需求澄清结果
1. **目标平台**: Web应用（H5），非微信小程序
2. **PRD范围**: 原文+补充（以文章功能为基础，补充PRD必要要素）
3. **PRD用途**: 开发指导级别（需要详细的功能规格、数据模型、接口定义等）
4. **附加要求**: 调用/grill-me深度分析，然后调用/tdd编写TDD文档

### 产品概述
- **产品名称**: 暑假成长积分银行（Summer Growth Points Bank）
- **核心概念**: 将五大成长维度（学习力、运动力、自控力、探索力、实践力）通过积分银行机制游戏化
- **目标用户**: 家长（主用户）+ 孩子（端用户）
- **核心理念**: 将无形的"自律"转变为有形的"资产"，用代币经济催化内在驱动力

### 已完成工作
1. [x] 抓取并解析微信文章内容
2. [x] 头脑风暴流程：探索上下文 -> 澄清问题 -> 提出方案 -> 呈现设计
3. [x] 编写完整PRD文档（8大章节，656行）
4. [x] 规格自检（修复了每周任务重置规则的歧义）
5. [x] Git初始化并提交

### PRD文档位置
`E:\git\growth-points-bank\PRD.md`

### PRD核心结构
1. 产品概述
2. 用户角色与权限（家长+孩子，权限矩阵）
3. 核心功能详述（5大功能：成长地图、今日打卡、每周复盘、奖励兑换、成长作品）
4. 补充功能（认证、多孩子管理、任务管理、积分系统、设置）
5. 数据模型（10个实体：Family/Parent/Child/Dimension/Task/CheckIn/PointTransaction/Reward/RewardRedemption/WeeklyReview/GrowthWork）
6. 页面规格（家长端9页+孩子端6页）
7. 非功能需求（响应式、性能、安全、可用性、兼容、视觉）
8. 设计理念与心理学基础

### 待完成工作
- [ ] 调用/grill-me对PRD进行深度分析
- [ ] 调用TDD技能编写测试驱动开发文档
- [ ] 保存project_memory.md

### 临时文件
以下临时文件位于E:\git\根目录，用于文章内容提取：
- wechat_article_raw.html - 原始HTML
- extract_article.ps1 - 第一版提取脚本
- extract_content2.ps1 - 第二版提取脚本
- article_content.txt - 提取的文本内容
- article_extracted.txt - 第一版提取结果
