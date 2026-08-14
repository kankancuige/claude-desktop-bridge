import assert from 'node:assert/strict'
import {normalizeWeChatBaseUrl} from './wechat-url.mjs'

assert.equal(normalizeWeChatBaseUrl('https://ilinkai.weixin.qq.com'), 'https://ilinkai.weixin.qq.com/')
assert.equal(normalizeWeChatBaseUrl('https://ilinkai.weixin.qq.com/other'), 'https://ilinkai.weixin.qq.com/')
assert.equal(normalizeWeChatBaseUrl('http://ilinkai.weixin.qq.com'), 'https://ilinkai.weixin.qq.com/')
assert.equal(normalizeWeChatBaseUrl('https://127.0.0.1:3456'), 'https://ilinkai.weixin.qq.com/')
assert.equal(normalizeWeChatBaseUrl('https://user:pass@ilinkai.weixin.qq.com'), 'https://ilinkai.weixin.qq.com/')
console.log('wechat-url tests passed')
