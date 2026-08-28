import test from 'node:test'
import assert from 'node:assert/strict'
import {applySkillRoute, routeSkills} from './skill-router.mjs'

test('协议更新只路由协议和设备 Skill，不附带 WinForms UI Skill', () => {
    const route = routeSkills({text: '按照最新协议更新帧解析、CRC 校验和扳手重连逻辑', profile: 'full'})
    assert.deepEqual(route, ['protocol-parser', 'device-driver'])
})

test('只有明确 UI 任务才路由 WinForms Skill', () => {
    assert.deepEqual(routeSkills({text: '修改 Form1 的按钮和 UI 线程更新', profile: 'full'}), ['ui-winforms'])
    assert.deepEqual(routeSkills({text: '检查 Form1 的协议解析，不要修改界面', profile: 'focused'}), ['protocol-parser'])
})

test('简单问题和 Skill 解释不路由任何 Skill', () => {
    assert.deepEqual(routeSkills({text: '这个 ui-winforms Skill 是干什么的？', profile: 'light'}), [])
    assert.deepEqual(routeSkills({text: '是否有必要使用这个 Skill', profile: 'focused'}), [])
})

test('路由结果稳定去重，未知内容不加载全部 Skill', () => {
    assert.deepEqual(routeSkills({text: '帮我看看这个文件是否正确', workDir: 'D:\\hcd\\扳手\\协航\\WindowsFormsApp1', profile: 'focused'}), [])
    const original = {skills: ['old']}
    const updated = applySkillRoute(original, ['protocol-parser', 'protocol-parser', 1])
    assert.deepEqual(updated.skills, ['protocol-parser'])
    assert.deepEqual(original.skills, ['old'])
})

test('数字孪生集成任务加载专用 Skill', () => {
    for (const text of [
        '为工业数字孪生生成 STEP 和 GLB，并建立 twin manifest',
        '把 GLB 节点绑定到设备遥测状态',
        '更新机器人孪生 URDF 关节和传感器映射',
        '将 CAD 零件节点绑定到设备 ID 和告警状态',
    ]) {
        assert.deepEqual(routeSkills({text, profile: 'full'}), ['digital-twin-cad'], text)
    }
})

test('普通 CAD、GLB Viewer 和前端任务不加载数字孪生 Skill', () => {
    assert.deepEqual(routeSkills({text: '帮我画一个普通 CAD 零件', profile: 'full'}), [])
    assert.deepEqual(routeSkills({text: '做一个 GLB Viewer 预览页面', profile: 'full'}), [])
    assert.deepEqual(routeSkills({text: '做一个 GLB Viewer 预览页面', targetFiles: ['src/App.vue'], profile: 'full'}), ['vue-frontend'])
    assert.deepEqual(routeSkills({text: '这个 digital-twin-cad Skill 是干什么的？', profile: 'focused'}), [])
})

test('项目架构决定 UI Skill，泛词不再猜测框架', () => {
    const avalonia = {languages: ['C#'], frameworks: ['Avalonia']}
    const vue = {languages: ['TypeScript'], frameworks: ['Vue 3']}
    const winforms = {languages: ['C#'], frameworks: ['WinForms']}
    assert.deepEqual(routeSkills({text: '页面增加主题切换', projectContext: avalonia, profile: 'full'}), ['avalonia-ui'])
    assert.deepEqual(routeSkills({text: '页面增加主题切换', projectContext: vue, profile: 'full'}), ['vue-frontend'])
    assert.deepEqual(routeSkills({text: '按钮间距调整', projectContext: winforms, profile: 'full'}), ['ui-winforms'])
    assert.deepEqual(routeSkills({text: '页面增加主题切换', profile: 'full'}), [])
})

test('明确否定框架时抑制对应 Skill', () => {
    assert.deepEqual(routeSkills({text: '这是 Avalonia 项目，不要使用 Vue，修改页面主题', projectContext: {frameworks: ['Avalonia']}, profile: 'full'}), ['avalonia-ui'])
    assert.deepEqual(routeSkills({text: '这是 C# 项目，不使用 WinForms，调整按钮', projectContext: {frameworks: ['WinForms']}, profile: 'full'}), [])
    assert.deepEqual(routeSkills({text: '不要使用 Vue，修改组件', profile: 'full'}), [])
})

test('Skill 注入诊断请求不会再次触发被诊断的 Skill', () => {
    assert.deepEqual(routeSkills({text: '明明是 C# Avalonia 项目，怎么注入的 Vue3 Skill', projectContext: {frameworks: ['Avalonia']}, profile: 'full'}), [])
    assert.deepEqual(routeSkills({text: 'Avalonia 项目里提到了 Vue，但目标仍是修改 AXAML 页面', projectContext: {frameworks: ['Avalonia']}, profile: 'full'}), ['avalonia-ui'])
})

test('数字孪生任务只有明确开发设备连接或驱动时才联合加载设备 Skill', () => {
    assert.deepEqual(
        routeSkills({text: '为设备数字孪生添加串口驱动、断线重连和 GLB 节点状态绑定', profile: 'full'}),
        ['digital-twin-cad', 'device-driver'],
    )
})

test('只有明确记忆操作才加载 Bridge Memory Skill', () => {
    assert.deepEqual(routeSkills({text: '把当前项目的 UTF-8 编码约定记住，写入项目 Memory', profile: 'full'}), ['bridge-memory'])
    assert.deepEqual(routeSkills({text: '忘记刚才记录的项目约定', profile: 'full'}), ['bridge-memory'])
    assert.deepEqual(routeSkills({text: '这个 Memory Skill 是干什么的？', profile: 'focused'}), [])
    assert.deepEqual(routeSkills({text: '修改代码并使用 UTF-8 编码', profile: 'full'}), [])
})

test('数字孪生参考图和程序化代理任务加载专用 Skill', () => {
    for (const text of [
        '根据参考图片生成数字孪生运行时的程序化 Three.js 模型',
        '将单张 image-proxy 转成工业孪生的 GLB 运行时代理并写入 manifest',
        '将 image-to-3D runtime proxy 用于 robot twin，并保留为非工程权威资产',
    ]) {
        assert.deepEqual(routeSkills({text, profile: 'full'}), ['digital-twin-cad'], text)
    }
})

test('工业拧紧项目技术方案任务加载专用 Skill', () => {
    for (const text of [
        '编写智能拧紧项目技术方案，覆盖工位、扭矩追溯和验收',
        '根据招标响应整理 MES/KMIS 接口和实施方案',
        '评审车间大屏与扭矩校验台的技术协议',
    ]) {
        const expected = text.includes('技术协议')
            ? ['industrial-tightening-solution', 'protocol-parser']
            : ['industrial-tightening-solution']
        assert.deepEqual(routeSkills({text, profile: 'full'}), expected, text)
    }
})

test('普通代码任务不加载工业拧紧技术方案 Skill', () => {
    assert.deepEqual(routeSkills({text: '修复一个普通 JavaScript 函数的单元测试', profile: 'full'}), [])
    assert.deepEqual(routeSkills({text: '这个 industrial-tightening-solution Skill 是干什么的？', profile: 'focused'}), [])
})

test('证据型当前与目标架构图联合加载两个图示 Skill', () => {
    for (const text of [
        '根据仓库证据绘制当前架构图',
        '生成目标系统上下文图和部署图',
        '用 Mermaid 输出架构演进图',
        '重绘 draw.io 的系统容器图',
    ]) {
        assert.deepEqual(routeSkills({text, profile: 'full'}), [
            'ln-75-architecture-diagram-builder',
            'diagram-design',
        ], text)
    }
})

test('普通图示产物只加载 diagram-design Skill', () => {
    for (const text of [
        '生成订单处理流程图 SVG',
        '绘制数据库 ER 图',
        '创建用户旅程图 HTML',
    ]) {
        const expected = text.includes('数据库') ? ['diagram-design', 'db-sql'] : ['diagram-design']
        assert.deepEqual(routeSkills({text, profile: 'full'}), expected, text)
    }
})

test('架构解释、审查和 Skill 说明不加载架构图 Skill', () => {
    for (const text of [
        '解释一下当前项目的架构是什么',
        '审查目标架构是否合理，不需要画图',
        'ln-75-architecture-diagram-builder Skill 是干什么的？',
        'diagram-design 是否有必要使用？',
    ]) {
        assert.deepEqual(routeSkills({text, profile: 'focused'}), [], text)
    }
})
