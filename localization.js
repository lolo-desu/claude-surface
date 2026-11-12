// Surface-owned messages only. Native controls and user-authored names/content
// remain under SillyTavern's localization and data ownership.
export const messages = {
    'SillyTavern 首页':'SillyTavern home', 'Claude 首页':'Claude home',
    '停用界面':'Disable interface', '停用 Claude Surface':'Disable Claude Surface',
    '请选择小于 20 MB 的图片。':'Choose an image smaller than 20 MB.',
    '操作未完成，请关闭当前面板后重试。':'The action could not be completed. Close this panel and try again.',
    '此偏好用于 Claude 风格，切回后继续生效。':'This preference applies to the Claude design and is kept when switching designs.',
    '完全显示':'Always visible', '滑动隐藏':'Hide on scroll', '点击显示':'Show on tap', '完全隐藏':'Always hidden',
    '预设':'Presets', '世界书':'World info', '角色卡':'Characters', '更多':'More',
    '新建聊天':'New chat', '取消侧栏常驻':'Unpin sidebar', '固定侧栏':'Pin sidebar', '打开侧栏':'Open sidebar',
    '关闭侧栏':'Close sidebar', '关闭面板（也可向下拖动）':'Close panel (or drag down)', '关闭':'Close',
    'API 连接':'API connection', '回复格式':'Response formatting', '用户设置':'User settings',
    '背景':'Backgrounds', '扩展程序':'Extensions', '用户设定':'Personas', '主题设置':'Appearance',
    '主题':'Color mode', '系统':'System', '浅色':'Light', '深色':'Dark', '伴侣':'Companion', '主题色':'Accent color',
    '跟随主题伴侣的昼夜设置':'Follow Theme Companion color mode', '启用主题伴侣后可使用':'Enable Theme Companion to use this mode',
    '设计风格':'Design', '英文回复使用衬线字体':'Serif font for English replies', '显示原生菜单栏':'Show native toolbar',
    '显示 SillyTavern 背景图片':'Show SillyTavern background', '恢复默认效果':'Reset effects to defaults',
    '界面透明度':'Interface transparency', '界面毛玻璃':'Interface blur', '背景变暗':'Background dimming', '背景模糊':'Background blur',
    '快速回复收起':'Collapse Quick Replies', '输入栏紧凑模式':'Compact composer', '顶栏显示':'Header visibility',
    '原版首页与最近记录':'Native home and recent chats', '角色消息样式':'Character message style',
    '极简':'Minimal', '头像':'Avatar', '横幅':'Banner', '侧栏名称':'Sidebar name', '品牌图标':'Brand icon',
    '自定义':'Custom', '自定义图标':'Custom icon', '上传图标':'Upload icon', '移除自定义图标':'Remove custom icon',
    '图片读取失败，请换一张图片。':'Could not read the image. Try a different image.', '图片加载失败，请换一张图片。':'Could not load the image. Try a different image.', '应用名称':'App name',
    '背景与毛玻璃':'Background and glass', '外观':'Appearance', '聊天':'Chat', '布局':'Layout', '品牌':'Branding',
    '聊天记录':'Chat history',
    '编辑角色世界书':'Edit character world info', '编辑角色详情':'Edit character details', '打开原版聊天记录':'Open native chat history',
    '没有匹配的角色':'No matching characters', '选择角色后显示聊天。':'Select a character to see chats.',
    '选择角色后会显示在这里':'Your recent characters will appear here',
    '请先选择角色卡。':'Select a character first.', '收起最近聊天':'Collapse recent chats', '最近聊天':'Recent chats',
    '还没有最近聊天':'No recent chats yet', '周末愉快':'Have a great weekend', '今天过得怎么样':'How is your day going',
    '朋友':'friend', '用户':'User', '模型与连接':'Model and connection', '连接模型':'Connect a model',
    '未连接到 API，请先连接模型':'Not connected to an API. Connect a model first.', '今天我能为您做些什么？':'What can I help you with today?',
    '回复':'Reply', '消息':'Message', '关闭原生面板':'Close native panel', '聊天操作':'Chat actions', '侧栏':'Sidebar',
    '搜索最近角色':'Search recent characters', '首页':'Home', '最近使用的角色':'Recent characters',
    '显示顶栏':'Show header', '选择角色，开始对话':'Choose a character to start chatting', '返回':'Return to',
    'API 连接与模型选择':'API connection and model', '完整聊天菜单':'Chat menu', '附件与扩展菜单':'Attachments and extensions',
    '启用 Claude 界面':'Enable Claude Surface', '状态':'Status', '清空全部世界书':'Clear all world info', '移除此世界书':'Remove this world info',
    '导入':'Import', '导出':'Export', '重命名':'Rename', '复制':'Copy', '删除':'Delete', '展开全部':'Expand all',
    '收起全部':'Collapse all', '填充标题':'Fill titles', '应用排序':'Apply sorting', '新条目':'New entry',
    '更多世界书操作':'More world info actions', '更多条目设置':'More entry settings', '没有匹配的条目':'No matching entries',
    '选择世界书后，在这里查看和编辑条目':'Choose world info to view and edit entries here',
    '陶土':'Clay', '橄榄':'Olive', '石墨':'Slate', '天蓝':'Azure', '丁香':'Lilac', '薄荷':'Mint', '杏桃':'Peach',
    '蓝色':'Blue', '青绿':'Teal', '紫罗兰':'Violet', '橙色':'Orange', '朱红':'Vermilion', '钴蓝':'Cobalt', '苔金':'Olive gold',
};
const terminology = {'对话':'聊天','新建对话':'新建聊天','新建会话':'新建聊天','对话操作':'聊天操作','侧边栏':'侧栏','侧边栏名称':'侧栏名称','取消侧边栏常驻':'取消侧栏常驻','固定侧边栏':'固定侧栏','打开侧边栏':'打开侧栏','关闭侧边栏':'关闭侧栏','跟随系统':'系统','跟随主题伴侣':'伴侣','重置效果':'恢复默认效果'};
export function createLocalizer(locale, translate = text => text) {
    const chinese = /^zh(?:-|$)/i.test(locale);
    return value => {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim(), text = terminology[trimmed] || trimmed;
        const english = messages[text];
        if (!english) return value;
        const result = translate(chinese ? text : english, 'claude_surface.' + english);
        return value.startsWith(' ') ? ' ' + result : value.endsWith(' ') ? result + ' ' : result;
    };
}
