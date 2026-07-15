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
3. [x] 编写完整PRD文档（10大章节，722行）
4. [x] 规格自检（修复了每周任务重置规则的歧义）
5. [x] Git初始化并提交
6. [x] 调用/grill-me对PRD进行10轮深度拷问
7. [x] 根据grilling决策更新PRD（移除拍照/录像，改为纯文字成长日记等）
8. [x] 调用/tdd编写TDD测试规格文档（64个测试，4层测试金字塔）
9. [x] 保存project_memory.md

### Grilling决策汇总
1. 任务验证：信任+抽检（家长可撤销不实打卡）
2. 积分过期：永久保留，跨暑假累积
3. 兄弟姐妹可见性：默认不可见+家庭成就墙
4. 每周复盘：真正双盲机制
5. 惩罚机制：无惩罚，积分只增不减
6. 奖励履约：增加待履约→已兑现状态追踪
7. 年龄适配：任务模板按年龄段推荐
8. 离线冲突：最后写入+冲突告警
9. 数据导出：PDF成长档案+日记导出
10. MVP分期：分两期；移除拍照/录视频功能

### TDD文档位置
`E:\git\growth-points-bank\TDD_SPEC.md`

### TDD核心结构
- 20个单元测试（领域逻辑纯函数）
- 28个集成测试（API接口）
- 14个组件测试（前端React组件）
- 2个E2E测试（完整用户流程）
- 总计64个测试，按垂直切片组织

### 技术栈假设
- 前端: React 18 + TypeScript + Vitest + Testing Library
- 后端: Node.js + Express/Fastify + Vitest + supertest
- 数据库: PostgreSQL（生产）/ SQLite in-memory（测试）
- E2E: Playwright

### 临时文件
以下临时文件位于E:\git\根目录，用于文章内容提取：
- wechat_article_raw.html - 原始HTML
- extract_article.ps1 - 第一版提取脚本
- extract_content2.ps1 - 第二版提取脚本
- article_content.txt - 提取的文本内容
- article_extracted.txt - 第一版提取结果
