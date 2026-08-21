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
    assert.deepEqual(routeSkills({text: '做一个 GLB Viewer 预览页面', profile: 'full'}), ['vue-frontend'])
    assert.deepEqual(routeSkills({text: '这个 digital-twin-cad Skill 是干什么的？', profile: 'focused'}), [])
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
