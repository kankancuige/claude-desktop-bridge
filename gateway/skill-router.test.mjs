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
