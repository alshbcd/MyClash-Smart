/**
 * mihomo配置覆写脚本（全量版 · 故障转移增强）
 * 原作者：AIsouler
 * 源仓库：https://github.com/AIsouler/MyClash
 * 友情推荐，非常好用、省电且内存占用低的代理软件：https://github.com/appshubcc/Bettbox
 *
 * ==================================================================
 * 基线：AIsouler/MyClash 上游原版
 * 本版只做两件事：加故障转移、修原版已有的几处 bug。没有引入其他 fork
 * 的功能（链式代理、epicgames 规则集等一概没有）。
 *
 * 一、故障转移结构（地区级独立 fallback）
 *
 *   地区（select）
 *   ├─ 地区-自动选择（url-test）  按延迟挑
 *   ├─ 地区-故障转移（fallback）  按顺序兜底
 *   └─ 地区下的真实节点
 *
 *   默认代理-故障转移（fallback）  成员是各地区-故障转移组，负责跨地区降级
 *   极简模式下没地区组，它退化为全部裸节点，不会变成空组
 *
 * 二、故障转移的关键参数
 *
 *   fallbackCheckInterval  = 10  探活间隔（秒）
 *   fallbackMaxFailedTimes = 2   连续拨号失败几次后强制复查
 *   从「节点挂掉」到「新连接绕开它」最坏一个 interval（10s）。
 *   注意不是 10 × 2：max-failed-times 统计的是真实拨号失败，作用只是提前触发复查，
 *   探活本身一次失败就判死（详见下面两个常量的注释）。
 *   10s 只适合少量节点（≤10 个）。单轮耗时 = ceil(节点数/10) × 6s，
 *   节点涨到 11 个以上就必须把 interval 调回 20 以上，否则 tick 会撞车。
 *
 * 三、原版的 bug（都已修）
 *
 *   1. groupBaseOption 缺 expected-status。默认值是 '*'，表示不限状态码，
 *      节点返回 403/451/502 这类「TCP 通但服务不可用」也会被判健康，
 *      故障转移就永远不会触发。已补 '200'。
 *   2. tun.stack 写的是 'mips'，不是合法值。mihomo 只认 system / gvisor / mixed，
 *      非法值会被静默回落到 gvisor——不报错，但你以为在用的配置其实没生效。
 *      已改成显式的 'gvisor'。
 *   3. default-selected 硬编码地区名（AI → 美国、PayPal → 美国、Patreon → 香港）。
 *      订阅里没有对应地区时 mihomo 不报错，只在启动日志里刷警告。
 *      现在先校验目标存在，不存在就不写这个字段。
 *   4. GLOBAL 把所有分流组都铺进去，成员 30 多个，客户端里翻不到底。
 *      而 rule 模式下它只在手动切全局模式时才用得到。已精简为
 *      「默认代理 + 自建 + 直连 + 各地区组」。
 *   5. 极简模式和非极简模式各写了一套 fallback 逻辑（原版没有 fallback，
 *      是后来加的），靠 if 块内的 const 遮蔽外层变量，不报错但纯冗余。
 *      已合并成一份。
 *   6. 「故障转移」不在 baseGroups 里，policyGroupOptions 就扫不到它，
 *      用户在 Bettbox 面板里看不到这个开关。已在末尾手动追加。
 *   7. 节点名与策略组名/内置出站同名时会整份配置加载失败（内核报 duplicate name，
 *      或者成员按名字查到策略组后 proxyGroupsDagSort 判出环）。节点名不可控，
 *      已加保留名清单，冲突节点自动加「(节点)」后缀。
 * ==================================================================
 */

// --- 静态配置区域 ---

// 适配 Bettbox 自定义配置参数
const Compatible_With_Bettbox = { ruleOptionsEnable: true };

/**
 * 自定义配置选项
 * true = 启用
 * false = 禁用
 */
const ruleOptionsEnable = {
  // 基础策略组
  手动选择: true, // 是否启用手动选择策略组
  自动选择: true, // 是否启用自动选择策略组
  负载均衡: true, // 是否启用负载均衡策略组
  故障转移: true, // 是否启用各地区独立的故障转移策略组

  // 以下为分流策略配置
  FCM: true, // GoogleFCM服务
  YouTube: true, // YouTube视频平台
  Google: true, // Google服务
  AI: true, // 国外AI服务
  GitHub: true, // GitHub代码托管平台
  Microsoft: true, // Microsoft服务
  Apple: true, // Apple服务
  Telegram: true, // Telegram通讯软件
  Steam: true, // Steam游戏平台
  TikTok: true, // TikTok视频平台
  Twitter: true, // Twitter社交平台
  Meta: true, // Meta服务
  Line: true, // Line通讯软件
  Netflix: true, // Netflix视频平台
  Emby: true, // Emby媒体服务
  PikPak: true, // PikPak网盘服务
  Spotify: true, // Spotify音乐服务
  Crypto: true, // 加密货币相关服务
  PayPal: true, // PayPal支付服务
  Patreon: true, // Patreon创作者赞助平台
  EHentai: true, // E-Hentai网站
  AdBlock: true, // 广告拦截

  // 以下为非分流策略配置
  极简模式: false, // 是否启用极简模式
  生成地区自动选择组: true, // 是否生成地区自动选择策略组
  隐藏地区手动选择组: false, // 是否隐藏地区手动选择策略组
  生成倍率组: true, // 是否生成低倍率/高倍率策略组
  生成家宽节点组: true, // 是否生成家宽（住宅/原生 IP）节点策略组
  分流组添加所有节点: false, // 是否为分流策略组添加所有节点
  过滤低倍率节点: false, // 是否过滤低倍率节点
  过滤高倍率节点: false, // 是否过滤高倍率节点
  过滤非地区节点: true, // 是否过滤非地区节点
  屏蔽国外QUIC: true, // 是否屏蔽国外QUIC流量
  代理IPV4优先: false, // 是否将订阅节点统一为 IPv4 优先（与“代理IPV6优先”同时开启时不生效）
  代理IPV6优先: false, // 是否将订阅节点统一为 IPv6 优先（与“代理IPV4优先”同时开启时不生效）
};

/**
 * 局域网共享开关
 *
 * false（当前）：内核只监听 127.0.0.1，本机以外的设备连不进来。
 *              此时 bind-address 会被内核直接忽略（listener.go 的 genAddr 在 allowLan
 *              为 false 时固定返回 127.0.0.1:port），认证也不会下发。
 * true：监听 0.0.0.0:7890，同一 WiFi 下的手机、电视、平板都能把你电脑当代理用。
 *       必须同时把下面的 lanAuthentication 改成真实账号密码，否则等于对所有人敞开。
 */
const allowLan = false;

/**
 * 局域网访问认证（只在 allowLan 为 true 时生效）
 *
 * 背景：allowLan 打开后监听 0.0.0.0:7890，不配 authentication 的话，
 * 同一 WiFi 下任何人扫到 7890 端口就能免费用你的订阅流量，你的机场流量会被别人跑光，
 * 排查时还看不到自己这边有任何异常。
 *
 * 格式：'用户名:密码'。可以写多个，客户端填任意一组都能通过。
 *      内核按「第一个冒号」切分（strings.Cut），所以密码里可以有冒号，用户名里不行。
 *
 * ⚠️ 把 allowLan 改成 true 之前，必须把 用户名/密码 换成你自己的。
 *    原样留着等于没设——这两个词是公开的默认值。
 *    改完记得同步到每台用这套代理的设备（手机/电视的代理设置里要填同样的账号密码），
 *    否则它们会连得上端口但代理不工作。
 *    密码建议只用字母和数字，避开 @ : / # ? 这些会跟 URI、YAML 打架的字符。
 */
const lanAuthentication = ['用户名:密码'];

// 定义前置规则
const prefixRules = [
  // 规则集下载域名，避免出现鸡蛋问题
  'DOMAIN,cdn.jsdmirror.com,直连',

  // 私有网络直连
  'RULE-SET,private,直连',

  // 国内直连
  'RULE-SET,geolocation-cn,直连',
  'RULE-SET,games_cn,直连', // 已包含 steam 下载域名
  'RULE-SET,nvidia_cn,直连',
  'RULE-SET,apple_cn,直连',
  'RULE-SET,microsoft_cn,直连',
  'DOMAIN,fsend.cn,直连',
  'DOMAIN,international-gfe.download.nvidia.com,直连',
  'DOMAIN-SUFFIX,ctaiot.com,直连',
];

// 此处添加自定义节点，填入下方[]内（可选，留空则不生成“自建节点”策略组）
// 自定义节点不参与节点过滤与 hosts 改写；与订阅节点（标准化后）重名时自动添加“自建-”前缀
// 示例：
// const customizeProxies = [
//   {
//     name: '自建-日本-01',
//     type: 'vmess',
//     server: '5.6.7.8',
//     port: 443,
//     uuid: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
//     alterId: 0,
//     cipher: 'auto',
//     tls: true,
//     servername: 'example.com',
//     network: 'ws',
//     'ws-opts': {
//       path: '/path',
//       headers: { Host: 'example.com' },
//     },
//   },
// ];
const customizeProxies = [];

// 定义全局排除节点的正则表达式，用于排除非地区节点
const excludeFilter =
  /群|返利|循环|官网|客服|网站|网址|获取|订阅|流量|到期|机场|下次|版本|官址|备用|过期|已用|联系|邮箱|工单|贩卖|通知|倒卖|防止|国内|地址|频道|电报|无法|说明|提示|访问|支持|教程|关注|更新|作者|加入|超时|收藏|优惠|福利|邀请|好友|失联|选择|剩余|公益|发布|DIZTNA|通路|登录|禁止|定时|渠道|牢记|永久|余额|阁下|本站|刷新|导航|建议|重置|以下|过滤|⚠️|@|t\.me\/\+|\bexpire\b|\bhttps?:\/\/|\.com|\btraffic\b/iu;

// 屏蔽国外QUIC
const blockForeignQuic = [
  'AND,((NETWORK,UDP),(DST-PORT,443),(NOT,((OR,((RULE-SET,cn_additional),(RULE-SET,cn_ip,no-resolve)))))),REJECT',
];

// 直连节点
const directProxies = [
  {
    name: '🇨🇳 直连 | 双栈',
    type: 'direct',
  },
  {
    name: '🇨🇳 直连 | IPv4优先',
    type: 'direct',
    'ip-version': 'ipv4-prefer',
  },
  {
    name: '🇨🇳 直连 | IPv6优先',
    type: 'direct',
    'ip-version': 'ipv6-prefer',
  },
  {
    name: '🇨🇳 直连 | 仅IPv4',
    type: 'direct',
    'ip-version': 'ipv4',
  },
  {
    name: '🇨🇳 直连 | 仅IPv6',
    type: 'direct',
    'ip-version': 'ipv6',
  },
];

// 图标 URL 公共前缀
const iconBaseUrl = 'https://cdn.jsdmirror.com/gh/AIsouler/MyClash@main/Icons/svg/';

// 规则集 URL 公共前缀
const ruleSetBaseUrl = 'https://cdn.jsdmirror.com/gh/appshubcc/bett-rules@meta/geo/';

// 定义地区策略组
const regionDefinitions = [
  {
    name: '香港',
    flag: '🇭🇰',
    regex: /🇭🇰|香港|(?<![A-Za-z])HKG?(?![A-Za-z])|hong\s*kong/i,
    icon: `${iconBaseUrl}HongKong.svg`,
  },
  {
    name: '日本',
    flag: '🇯🇵',
    regex: /🇯🇵|日本|东京|大阪|京都|(?<![A-Za-z])JPN?(?![A-Za-z])|japan/i,
    icon: `${iconBaseUrl}Japan.svg`,
  },
  {
    name: '美国',
    flag: '🇺🇸',
    regex:
      /🇺🇸|美国|纽约|洛杉矶|旧金山|芝加哥|休斯顿|迈阿密|西雅图|波士顿|华盛顿|拉斯维加斯|圣何塞|(?<![A-Za-z])USA?(?![A-Za-z])|america|united\s*states/i,
    icon: `${iconBaseUrl}America.svg`,
  },
  {
    name: '新加坡',
    flag: '🇸🇬',
    regex: /🇸🇬|新加坡|狮城|(?<![A-Za-z])SGP?(?![A-Za-z])|singapore/i,
    icon: `${iconBaseUrl}Singapore.svg`,
  },
  {
    name: '台湾',
    flag: '🇹🇼',
    regex: /🇹🇼|台湾|台北|高雄|(?<![A-Za-z])TWN?(?![A-Za-z])|taiwan/i,
    icon: `${iconBaseUrl}Taiwan.svg`,
  },
];

// 定义倍率策略组
const lowRateRegionName = '低倍率节点';
const highRateRegionName = '高倍率节点';

const rateRegionDefinitions = [
  {
    name: lowRateRegionName,
    regex:
      /^(?!.*(?:剩|期)).*(?:(?<![\d.])0(\.[0-5]|[*×✕✖⨯⨉x倍]))|(?:[*×✕✖⨯⨉x]0)|^(?!.*(?:客户端|软件)).*下载|低倍|免费|(?<![A-Za-z])free(?![A-Za-z])/i,
    icon: `${iconBaseUrl}Available.svg`,
  },
  {
    name: highRateRegionName,
    regex:
      /(?:[*×✕✖⨯⨉x](?:[2-9]\d*|[1-9]\d+)(?:\.\d+)?)|(?:(?<![\d.])(?:[2-9]\d*|[1-9]\d+)(?:\.\d+)?(?:倍|[*×✕✖⨯⨉x]))/i,
    icon: `${iconBaseUrl}Airport.svg`,
  },
];

// 定义家宽（住宅/原生 IP）节点策略组
const homeRegionName = '家宽节点';

const homeRegionDefinitions = [
  {
    name: homeRegionName,
    regex: /家宽|住宅|原生\s*IP|家庭宽带|\bISP\b|\bRES\b|residential/i,
    icon: `${iconBaseUrl}Home.svg`,
  },
];

// 全部策略组定义（地区 + 倍率 + 家宽），统一用于节点匹配与归类
const allRegionDefinitions = [...regionDefinitions, ...rateRegionDefinitions, ...homeRegionDefinitions];

// Rule Providers 通用配置
const ruleProviderCommonDomain = {
  type: 'http',
  format: 'mrs',
  interval: 86400,
  behavior: 'domain',
};
const ruleProviderCommonIpcidr = {
  type: 'http',
  format: 'mrs',
  interval: 86400,
  behavior: 'ipcidr',
};

// 定义基础 Rule Providers
const baseRuleProviders = {
  // --- 直连规则集 ---

  private: {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/private.mrs`,
    path: './ruleset/private.mrs',
    'path-in-bundle': 'geo/geosite/private.mrs',
  },
  private_ip: {
    ...ruleProviderCommonIpcidr,
    url: `${ruleSetBaseUrl}geoip/private.mrs`,
    path: './ruleset/private_ip.mrs',
    'path-in-bundle': 'geo/geoip/private.mrs',
  },
  games_cn: {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/category-games@cn.mrs`,
    path: './ruleset/category-games@cn.mrs',
    'path-in-bundle': 'geo/geosite/category-games@cn.mrs',
  },
  nvidia_cn: {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/nvidia@cn.mrs`,
    path: './ruleset/nvidia@cn.mrs',
    'path-in-bundle': 'geo/geosite/nvidia@cn.mrs',
  },
  apple_cn: {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/apple@cn.mrs`,
    path: './ruleset/apple@cn.mrs',
    'path-in-bundle': 'geo/geosite/apple@cn.mrs',
  },
  microsoft_cn: {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/microsoft@cn.mrs`,
    path: './ruleset/microsoft@cn.mrs',
    'path-in-bundle': 'geo/geosite/microsoft@cn.mrs',
  },
  'geolocation-cn': {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/geolocation-cn.mrs`,
    path: './ruleset/geolocation-cn.mrs',
    'path-in-bundle': 'geo/geosite/geolocation-cn.mrs',
  },
  cn_ip: {
    ...ruleProviderCommonIpcidr,
    url: `${ruleSetBaseUrl}geoip/cn.mrs`,
    path: './ruleset/cn_ip.mrs',
    'path-in-bundle': 'geo/geoip/cn.mrs',
  },

  // --- 代理规则集 ---

  'geolocation-!cn': {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/geolocation-!cn.mrs`,
    path: './ruleset/geolocation-!cn.mrs',
    'path-in-bundle': 'geo/geosite/geolocation-!cn.mrs',
  },

  // --- 其他规则集 ---

  fakeip_filter: {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/fakeip-filter.mrs`,
    path: './ruleset/fakeip-filter.mrs',
    'path-in-bundle': 'geo/geosite/fakeip-filter.mrs',
  },
  cn_additional: {
    ...ruleProviderCommonDomain,
    url: 'https://static-file-global.353355.xyz/rules/cn-additional-list.mrs',
    path: './ruleset/cn-additional-list.mrs',
    'path-in-bundle': 'geo/geosite/cn.mrs',
  },
  cn: {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/cn.mrs`,
    path: './ruleset/cn.mrs',
    'path-in-bundle': 'geo/geosite/cn.mrs',
  },
  douyin: {
    ...ruleProviderCommonDomain,
    url: `${ruleSetBaseUrl}geosite/douyin.mrs`,
    path: './ruleset/douyin.mrs',
    'path-in-bundle': 'geo/geosite/douyin.mrs',
  },
};

// 策略组公共配置
// expected-status 必须设。默认值是 '*'（不限状态码），意味着节点返回 403/451/502
// 这类「域名被墙但 TCP 通」的响应也会被判成健康，故障转移就永远不触发，纯摆设。
// 实测探活地址 https://www.apple.com/library/test/success.html 返回 200，无重定向。
const groupBaseOption = {
  interval: 300,
  // 6000ms，不是内核默认的 5000。脚本开着 unified-delay，一次 URLTest 内部要发两次
  // 请求（第二次才是计入延迟的那次），而 timeout 卡的是整个 URLTest 的总时长，
  // 等于 6 秒要容下两轮 TCP+TLS 握手。设成 3000 时美欧节点一丢包就被判死，
  // 故障转移反而会把你切到更差的节点上。
  // 代价：真挂掉的节点最坏多等 6 秒才判死，这只影响「多久发现」，不影响切换结果。
  timeout: 6000,
  url: 'https://www.apple.com/library/test/success.html',
  'expected-status': '200',
  lazy: true,
  'max-failed-times': 3,
  'empty-fallback': 'REJECT',
};

// --- 探活节奏（故障转移的关键参数，改这里就够了）---

/**
 * 单位：秒。
 * 越小切换越快，但探活请求会成比例增加，机场侧看到的就是你的节点在发 HTTPS。
 *
 * 有一条硬约束：单轮探活耗时 ≈ ceil(节点数 / 10) × timeout。
 * 10 是内核写死的并发上限（provider/healthcheck.go 的 b.SetLimit(10)，无配置项），
 * timeout 就是上面的 6s。interval 必须大于单轮耗时，否则上一轮没跑完，下一次 tick
 * 会被 singleDo.Do 直接跳过，实际间隔等于单轮耗时，设定值等于白设。
 *   1~7 个节点   → 单轮最坏 6s  → interval 10 有 4s 余量，可行（当前情况）
 *   11~14 个节点 → 单轮最坏 12s → interval 10 顶满，必须调回 ≥ 20
 *   20 个节点    → 单轮最坏 12s → interval 30 合适
 *
 * 当前取 10s 的前提是「订阅只有 7 个节点 + 极简模式（全部节点挤在一个 fallback 组）」。
 * 探活量 = 7 × 360 = 2520 次/小时，按每次 3~5KB 算日均 240~400MB。
 * 订阅换成大节点包之后务必把这里调回去，否则探活会和真实流量抢带宽。
 *
 * 参考档位：
 * 60s：每节点每小时 60 次，20 节点约 1300 次/时，通用值。
 * 180s：折中，最坏 3 分钟切换，流量降到 1/3。
 * 300s：行业普遍值（Clash 系默认），最坏 5 分钟切换。
 *
 * 注意这个值只决定「定时探活」的快慢。有流量时走的是另一条更快的路——
 * 连续拨号失败 max-failed-times 次就立即全组重测，跟这里无关。
 */
const fallbackCheckInterval = 10;

/**
 * 官方定义：「最大失败次数，超过则触发一次强制健康检查」，默认 5。
 *
 * 注意它统计的**不是探活失败**，而是真实拨号失败（GroupBase.onDialFailed）。
 * 探活本身没有「连续失败几次才算死」的门槛：一次 URLTest 失败、或者状态码不匹配
 * expected-status，adapter.Proxy.URLTest 的 defer 里就直接 state.alive.Store(false)。
 * 也就是说节点是「测一次就判死」的。
 *
 * 所以这个值管的是「有流量时的加速通道」，不是判定门槛：
 *   有流量 → 连续拨号失败 2 次就强制体检一次，不必等下一个探活周期；
 *   没流量 → 等定时探活在 fallbackCheckInterval 内发现。
 * 两条路谁先到算谁，所以「节点挂掉 → 新连接绕开它」最坏就是一个 interval，
 * 不是 interval × max-failed-times。
 *
 * 有个细节：groupbase.go 的 onDialFailed 里，两次失败必须发生在 testTimeout 毫秒
 * 之内才会累加，超时就把计数清零。testTimeout 就是上面的 timeout: 6000，
 * 所以这个加速通道的有效窗口是 6 秒。
 *
 * 调到 1 的代价是：网络抖一下就触发一轮全组体检，换来频繁重连和断流。
 */
const fallbackMaxFailedTimes = 2;

// select策略组通用配置
const selectBaseOption = {
  ...groupBaseOption,
  type: 'select',
};

// url-test策略组通用配置
// 这里不重复写 interval / timeout / max-failed-times，沿用 groupBaseOption 的 300s。
// 想让它响应更快可以单独加 interval: 180，但那是额外的探活开销，按需改。
//
// 300s 与 fallback 的 fallbackCheckInterval 不等长是有意的：url-test 只决定「谁最快」，
// 慢一分钟无所谓；fallback 决定「谁还活着」，慢一分钟就是断流。
// 两者共用一个值只会让其中一个变差。
//
// lazy 沿用 groupBaseOption 的 true（懒测）。唯一的例外是极简模式下的
// 「默认代理-自动选择」，那里会覆盖成 false，原因见该处注释。
const urlTestBaseOption = {
  ...groupBaseOption,
  type: 'url-test',
  tolerance: 50,
  'exclude-type': 'DIRECT',
  icon: `${iconBaseUrl}Auto.svg`,
  hidden: true,
};

// fallback策略组通用配置
// 与 url-test 的本质区别：
//   url-test 永远挑延迟最低的，延迟一波动就在节点之间来回跳；
//   fallback 严格按 proxies 顺序取第一个可用的，前面一挂立刻顶下一个，属主备模型。
//
// lazy 必须显式设 false。官方定义：「未选择到当前策略组时，不进行测试」，默认 true。
// 也就是说用户没在界面上手动选中某个 fallback 组时，它压根不探活，状态一直过期，
// 真出故障要接管时才发现拿的是旧数据，切换会慢一大拍。故障转移组必须常测。
// 唯一的例外是「成员全是策略组」的全局 fallback，调用侧会把它覆盖成 true——
// 那时子组已经在常测，再测一遍等于让每个节点被两套定时器打。
const fallbackBaseOption = {
  ...groupBaseOption,
  type: 'fallback',
  interval: fallbackCheckInterval,
  'max-failed-times': fallbackMaxFailedTimes,
  lazy: false,
  'exclude-type': 'DIRECT',
  // MyClash 的 Icons/svg 里没有 Fallback 专用图标，用 Available 代替，
  // 好处是跟其他组共用同一个 CDN，不额外依赖外部图标仓库。
  icon: `${iconBaseUrl}Available.svg`,
  hidden: true,
};

// load-balance策略组通用配置
const loadBalanceBaseOption = {
  ...groupBaseOption,
  type: 'load-balance',
  strategy: 'sticky-sessions',
  'exclude-type': 'DIRECT',
  icon: `${iconBaseUrl}RoundRobin.svg`,
  hidden: true,
};

// 定义基础策略组
// 注意：故障转移不在这里。它是地区级的，由 createRegionGroup 按地区动态生成，
// 硬塞进基础组只会得到一个铺满全部裸节点的巨型 fallback，与地区级完全重复。
const baseGroups = [
  {
    name: '手动选择',
    baseOption: selectBaseOption,
    includeAll: true,
    icon: `${iconBaseUrl}Static.svg`,
  },
  {
    name: '自动选择',
    baseOption: urlTestBaseOption,
    includeAll: true,
    icon: `${iconBaseUrl}Auto.svg`,
  },
  {
    name: '负载均衡',
    baseOption: loadBalanceBaseOption,
    includeAll: true,
    icon: `${iconBaseUrl}RoundRobin.svg`,
  },
];

// 定义分流策略组配置
const serviceConfigs = [
  ...baseGroups,
  {
    name: 'FCM',
    baseOption: selectBaseOption,
    direct: true,
    defaultSelected: '直连',
    providers: {
      googlefcm: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/googlefcm.mrs`,
        path: './ruleset/googlefcm.mrs',
        'path-in-bundle': 'geo/geosite/googlefcm.mrs',
      },
    },
    icon: `${iconBaseUrl}Fcm.svg`,
    rules: ['RULE-SET,googlefcm,FCM'],
  },
  {
    name: 'YouTube',
    baseOption: selectBaseOption,
    providers: {
      youtube: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/youtube.mrs`,
        path: './ruleset/youtube.mrs',
        'path-in-bundle': 'geo/geosite/youtube.mrs',
      },
    },
    icon: `${iconBaseUrl}YouTube.svg`,
    rules: ['RULE-SET,youtube,YouTube'],
  },
  {
    name: 'Google',
    baseOption: selectBaseOption,
    providers: {
      google: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/google.mrs`,
        path: './ruleset/google.mrs',
        'path-in-bundle': 'geo/geosite/google.mrs',
      },
      google_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/google.mrs`,
        path: './ruleset/google_ip.mrs',
        'path-in-bundle': 'geo/geoip/google.mrs',
      },
    },
    icon: `${iconBaseUrl}Google.svg`,
    rules: ['RULE-SET,google,Google', 'RULE-SET,google_ip,Google,no-resolve'],
  },
  {
    name: 'AI',
    baseOption: selectBaseOption,
    defaultSelected: '美国',
    providers: {
      ai: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/category-ai-!cn.mrs`,
        path: './ruleset/ai.mrs',
        'path-in-bundle': 'geo/geosite/category-ai-!cn.mrs',
      },
    },
    icon: `${iconBaseUrl}OpenAI.svg`,
    rules: ['RULE-SET,ai,AI'],
  },
  {
    name: 'GitHub',
    baseOption: selectBaseOption,
    providers: {
      github: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/github.mrs`,
        path: './ruleset/github.mrs',
        'path-in-bundle': 'geo/geosite/github.mrs',
      },
    },
    icon: `${iconBaseUrl}GitHub.svg`,
    rules: ['RULE-SET,github,GitHub'],
  },
  {
    name: 'Microsoft',
    baseOption: selectBaseOption,
    direct: true,
    providers: {
      microsoft: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/microsoft.mrs`,
        path: './ruleset/microsoft.mrs',
        'path-in-bundle': 'geo/geosite/microsoft.mrs',
      },
      microsoft_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/microsoft.mrs`,
        path: './ruleset/microsoft_ip.mrs',
        'path-in-bundle': 'geo/geoip/microsoft.mrs',
      },
    },
    icon: `${iconBaseUrl}Microsoft.svg`,
    rules: ['RULE-SET,microsoft,Microsoft', 'RULE-SET,microsoft_ip,Microsoft,no-resolve'],
  },
  {
    name: 'Apple',
    baseOption: selectBaseOption,
    direct: true,
    providers: {
      apple: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/apple.mrs`,
        path: './ruleset/apple.mrs',
        'path-in-bundle': 'geo/geosite/apple.mrs',
      },
      apple_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/apple.mrs`,
        path: './ruleset/apple_ip.mrs',
        'path-in-bundle': 'geo/geoip/apple.mrs',
      },
    },
    icon: `${iconBaseUrl}Apple.svg`,
    rules: ['RULE-SET,apple,Apple', 'RULE-SET,apple_ip,Apple,no-resolve'],
  },
  {
    name: 'Telegram',
    baseOption: selectBaseOption,
    providers: {
      telegram: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/telegram.mrs`,
        path: './ruleset/telegram.mrs',
        'path-in-bundle': 'geo/geosite/telegram.mrs',
      },
      telegram_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/telegram.mrs`,
        path: './ruleset/telegram_ip.mrs',
        'path-in-bundle': 'geo/geoip/telegram.mrs',
      },
    },
    icon: `${iconBaseUrl}Telegram.svg`,
    rules: ['RULE-SET,telegram,Telegram', 'RULE-SET,telegram_ip,Telegram,no-resolve'],
  },
  {
    name: 'Steam',
    baseOption: selectBaseOption,
    direct: true,
    providers: {
      steam: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/steam.mrs`,
        path: './ruleset/steam.mrs',
        'path-in-bundle': 'geo/geosite/steam.mrs',
      },
      steam_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/steam.mrs`,
        path: './ruleset/steam_ip.mrs',
        'path-in-bundle': 'geo/geoip/steam.mrs',
      },
    },
    icon: `${iconBaseUrl}Steam.svg`,
    rules: ['RULE-SET,steam,Steam', 'RULE-SET,steam_ip,Steam,no-resolve'],
  },
  {
    name: 'TikTok',
    baseOption: selectBaseOption,
    defaultSelected: '日本',
    providers: {
      tiktok: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/tiktok.mrs`,
        path: './ruleset/tiktok.mrs',
        'path-in-bundle': 'geo/geosite/tiktok.mrs',
      },
      tiktok_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/tiktok.mrs`,
        path: './ruleset/tiktok_ip.mrs',
        'path-in-bundle': 'geo/geoip/tiktok.mrs',
      },
    },
    icon: `${iconBaseUrl}TikTok.svg`,
    rules: ['RULE-SET,tiktok,TikTok', 'RULE-SET,tiktok_ip,TikTok,no-resolve'],
  },
  {
    name: 'Twitter',
    baseOption: selectBaseOption,
    providers: {
      twitter: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/twitter.mrs`,
        path: './ruleset/twitter.mrs',
        'path-in-bundle': 'geo/geosite/twitter.mrs',
      },
      twitter_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/twitter.mrs`,
        path: './ruleset/twitter_ip.mrs',
        'path-in-bundle': 'geo/geoip/twitter.mrs',
      },
    },
    icon: `${iconBaseUrl}Twitter.svg`,
    rules: ['RULE-SET,twitter,Twitter', 'RULE-SET,twitter_ip,Twitter,no-resolve'],
  },
  {
    name: 'Meta',
    baseOption: selectBaseOption,
    providers: {
      meta: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/meta.mrs`,
        path: './ruleset/meta.mrs',
        'path-in-bundle': 'geo/geosite/meta.mrs',
      },
      facebook_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/facebook.mrs`,
        path: './ruleset/facebook_ip.mrs',
        'path-in-bundle': 'geo/geoip/facebook.mrs',
      },
    },
    icon: `${iconBaseUrl}Meta.svg`,
    rules: ['RULE-SET,meta,Meta', 'RULE-SET,facebook_ip,Meta,no-resolve'],
  },
  {
    name: 'Line',
    baseOption: selectBaseOption,
    providers: {
      line: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/line.mrs`,
        path: './ruleset/line.mrs',
        'path-in-bundle': 'geo/geosite/line.mrs',
      },
    },
    icon: `${iconBaseUrl}Line.svg`,
    rules: ['RULE-SET,line,Line'],
  },
  {
    name: 'Netflix',
    baseOption: selectBaseOption,
    providers: {
      netflix: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/netflix.mrs`,
        path: './ruleset/netflix.mrs',
        'path-in-bundle': 'geo/geosite/netflix.mrs',
      },
      netflix_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/netflix.mrs`,
        path: './ruleset/netflix_ip.mrs',
        'path-in-bundle': 'geo/geoip/netflix.mrs',
      },
    },
    icon: `${iconBaseUrl}Netflix.svg`,
    rules: ['RULE-SET,netflix,Netflix', 'RULE-SET,netflix_ip,Netflix,no-resolve'],
  },
  {
    name: 'Emby',
    baseOption: selectBaseOption,
    direct: true,
    providers: {
      emby: {
        ...ruleProviderCommonDomain,
        url: 'https://cdn.jsdmirror.com/gh/666OS/rules@release/mihomo/domain/Emby.mrs',
        path: './ruleset/emby.mrs',
        'path-in-bundle': 'geo/geosite/category-emby.mrs',
      },
      emos: {
        ...ruleProviderCommonDomain,
        url: 'https://cdn.jsdmirror.com/gh/binaryu/emos-proxy-rule@main/rules/emos-mihomo.mrs',
        path: './ruleset/emos.mrs',
        'path-in-bundle': 'geo/geosite/category-emby.mrs',
      },
    },
    icon: `${iconBaseUrl}Emby.svg`,
    rules: [
      'RULE-SET,emby,Emby',
      'RULE-SET,emos,Emby',
      'DOMAIN-SUFFIX,mb3admin.com,Emby',
      'DOMAIN-SUFFIX,nubebelle.com,Emby',
      'DOMAIN-KEYWORD,emby,Emby',
      'PROCESS-NAME,com.mb.android,Emby',
      'PROCESS-NAME,tv.emby.embyatv,Emby',
      'PROCESS-NAME,com.hush.yamby,Emby',
      'PROCESS-NAME,com.jellycine.app,Emby',
      'PROCESS-NAME,com.mountains.hills,Emby',
      'PROCESS-NAME,RodelPlayer.App.exe,Emby',
      'PROCESS-NAME,com.feifeiduck.capyplayer,Emby',
    ],
  },
  {
    name: 'PikPak',
    baseOption: selectBaseOption,
    direct: true,
    providers: {
      pikpak: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/pikpak.mrs`,
        path: './ruleset/pikpak.mrs',
        'path-in-bundle': 'geo/geosite/pikpak.mrs',
      },
    },
    icon: `${iconBaseUrl}PikPak.svg`,
    rules: ['RULE-SET,pikpak,PikPak'],
  },
  {
    name: 'Spotify',
    baseOption: selectBaseOption,
    direct: true,
    providers: {
      spotify: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/spotify.mrs`,
        path: './ruleset/spotify.mrs',
        'path-in-bundle': 'geo/geosite/spotify.mrs',
      },
      spotify_ip: {
        ...ruleProviderCommonIpcidr,
        url: `${ruleSetBaseUrl}geoip/spotify.mrs`,
        path: './ruleset/spotify_ip.mrs',
        'path-in-bundle': 'geo/geoip/spotify.mrs',
      },
    },
    icon: `${iconBaseUrl}Spotify.svg`,
    rules: ['RULE-SET,spotify,Spotify', 'RULE-SET,spotify_ip,Spotify,no-resolve'],
  },
  {
    name: 'Crypto',
    baseOption: selectBaseOption,
    defaultSelected: '日本',
    providers: {
      cryptocurrency: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/category-cryptocurrency.mrs`,
        path: './ruleset/cryptocurrency.mrs',
        'path-in-bundle': 'geo/geosite/category-cryptocurrency.mrs',
      },
    },
    icon: `${iconBaseUrl}Bitcoin.svg`,
    rules: ['RULE-SET,cryptocurrency,Crypto'],
  },
  {
    name: 'PayPal',
    baseOption: selectBaseOption,
    defaultSelected: '美国',
    providers: {
      paypal: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/paypal.mrs`,
        path: './ruleset/paypal.mrs',
        'path-in-bundle': 'geo/geosite/paypal.mrs',
      },
    },
    icon: `${iconBaseUrl}PayPal.svg`,
    rules: ['RULE-SET,paypal,PayPal'],
  },
  {
    name: 'Patreon',
    baseOption: selectBaseOption,
    defaultSelected: '香港',
    providers: {
      patreon: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/patreon.mrs`,
        path: './ruleset/patreon.mrs',
        'path-in-bundle': 'geo/geosite/patreon.mrs',
      },
    },
    icon: `${iconBaseUrl}Patreon.svg`,
    rules: ['RULE-SET,patreon,Patreon'],
  },
  {
    name: 'EHentai',
    baseOption: selectBaseOption,
    direct: true,
    defaultSelected: '美国',
    providers: {
      ehentai: {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/ehentai.mrs`,
        path: './ruleset/ehentai.mrs',
        'path-in-bundle': 'geo/geosite/ehentai.mrs',
      },
    },
    icon: `${iconBaseUrl}EHentai.svg`,
    rules: ['RULE-SET,ehentai,EHentai'],
  },
  {
    name: 'AdBlock',
    baseOption: selectBaseOption,
    reject: true,
    providers: {
      'category-ads': {
        ...ruleProviderCommonDomain,
        url: `${ruleSetBaseUrl}geosite/category-ads.mrs`,
        path: './ruleset/category-ads.mrs',
        'path-in-bundle': 'geo/geosite/category-ads.mrs',
      },
    },
    icon: `${iconBaseUrl}AdBlock.svg`,
    rules: ['RULE-SET,category-ads,AdBlock'],
  },
];

/**
 * 适配 Bettbox 策略组开关
 * 声明哪些开关属于策略组：基础策略组 + 全部分流策略组。
 *
 * 额外追加「故障转移」：它不是基础策略组（由地区动态生成），但必须出现在
 * Bettbox 的开关面板里，否则用户在 App 里根本关不掉这个功能，只能改源码。
 */
Compatible_With_Bettbox.policyGroupOptions = [...serviceConfigs.map((svc) => svc.name), '故障转移'];

// ---节点过滤、重命名及验证---

/**
 * 零宽/不可见字符：部分机场会在节点名中逐字符插入这类字符（如 H\u200BK），会打断地区、倍率等正则匹配。
 *
 * 刻意排除三类「有语义」的字符，避免误伤：
 * - U+200C / U+200D（ZWNJ / ZWJ）：参与连字与 emoji 组合，删掉会改变字形；
 * - U+FE00–U+FE0F 及 U+E0100–U+E01EF（变体选择符）：控制 emoji 呈现方式。
 * 其余零宽/不可见字符不含任何语义，只用于干扰匹配，可安全忽略。
 */
const invisibleCharsRegex = /[\u00AD\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u115F\u1160\u3164\uFFA0]/g;

/**
 * 取节点名「可用于匹配」的形式：剥离零宽/不可见字符
 */
function toMatchableName(name) {
  return typeof name === 'string' ? name.replace(invisibleCharsRegex, '') : name;
}

/**
 * 节点匹配缓存，避免重复执行正则
 */
const regionMatchCache = new Map();
function getMatchedRegions(proxyName) {
  if (regionMatchCache.has(proxyName)) {
    return regionMatchCache.get(proxyName);
  }

  const matchableName = toMatchableName(proxyName);
  const regions = allRegionDefinitions.filter((region) => region.regex.test(matchableName));
  regionMatchCache.set(proxyName, regions);

  return regions;
}

/**
 * 标准化节点名称：补全地区国旗、折叠多余空格，并预缓存匹配结果
 */
const flagRegex = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
function normalizeProxyName(proxy) {
  const originalName = proxy.name;

  const flag = originalName.match(flagRegex)?.[0];

  const nameWithoutFlag = (flag ? originalName.replace(flag, '') : originalName).replace(/\s+/g, ' ').trim();

  const matchedRegions = getMatchedRegions(originalName);

  const regionFlag = flag || matchedRegions.find((region) => region.flag)?.flag;

  const normalizedName = regionFlag ? `${regionFlag} ${nameWithoutFlag}` : nameWithoutFlag;

  if (normalizedName !== originalName) {
    regionMatchCache.set(normalizedName, matchedRegions);
  }

  return normalizedName === originalName ? proxy : { ...proxy, name: normalizedName };
}

/**
 * 修复 dialer-proxy 引用：目标被重命名则更新，被移除或不存在则删除引用
 */
function fixDialerProxy(proxy, renameMap, normalizedProxyNames) {
  const target = proxy['dialer-proxy'];
  if (!target) return proxy;

  if (renameMap.has(target)) {
    return { ...proxy, 'dialer-proxy': renameMap.get(target) };
  }

  if (normalizedProxyNames.has(target)) {
    return proxy;
  }

  const copy = { ...proxy };
  delete copy['dialer-proxy'];
  return copy;
}

/**
 * 读取代理 IP 版本偏好：仅其中一个开关开启时返回对应偏好，
 * 同时开启或同时关闭时返回 null（不应用任何偏好，节点保持原样）
 */
function getIpVersionPreference() {
  const ipv4PreferEnabled = ruleOptionsEnable.代理IPV4优先;
  const ipv6PreferEnabled = ruleOptionsEnable.代理IPV6优先;

  if (ipv4PreferEnabled && !ipv6PreferEnabled) return 'ipv4-prefer';
  if (ipv6PreferEnabled && !ipv4PreferEnabled) return 'ipv6-prefer';
  return null;
}

/**
 * 覆写结果里「已经被占用」的名字。
 *
 * 为什么要这份清单：内核先注册 proxies、再注册 proxy-groups，两处都是按名字查表，
 * 同名会直接让整份配置加载失败，而且有两种失败形态：
 *   1. 节点名 == 组名：注册组时命中 proxies 表里已有的键，报 "the duplicate name"。
 *   2. 节点名 == 组名，且该节点恰好被别的组收录：成员按名字查表查到的是策略组而不是节点，
 *      proxyGroupsDagSort 会判出环（节点叫 AI → 其他节点-故障转移 → AI 策略组 → 默认代理）。
 * 节点名是机场给的、不可控，所以在覆写阶段让路：冲突的节点统一加「(节点)」后缀。
 *
 * 注意清单里也包含 directProxies 的三个名字，它们会被原样追加进 proxies，
 * 订阅里若正好有一个同名节点，同样会撞成 duplicate name。
 */
const reservedNames = new Set([
  'GLOBAL',
  '默认代理',
  '直连',
  '漏网之鱼',
  '自建节点',
  '默认代理-自动选择',
  '默认代理-故障转移',
  '其他节点',
  '其他节点-自动选择',
  '其他节点-故障转移',
  // baseGroups 已并入 serviceConfigs，这里一并覆盖
  ...serviceConfigs.map((svc) => svc.name),
  ...allRegionDefinitions.flatMap((r) => [r.name, `${r.name}-自动选择`, `${r.name}-故障转移`]),
  ...directProxies.map((p) => p.name),
  // 内核内置出站，同名会在 ParseProxy 阶段报 duplicate name
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'PASS-RULE',
  'COMPATIBLE',
]);

/**
 * 与保留名冲突时，给节点让出一个不冲突的名字。
 * 后缀里保留原名的地区关键字，覆盖后依然能正确归入地区组。
 */
function reserveProxyName(name, usedNames) {
  if (!reservedNames.has(name)) return name;

  let candidate = `${name} (节点)`;
  let index = 2;
  while (usedNames.has(candidate) || reservedNames.has(candidate)) {
    candidate = `${name} (节点 ${index++})`;
  }

  return candidate;
}

/**
 * 过滤并标准化节点：剔除内置/信息节点、按配置过滤、去重、修复 dialer-proxy 引用，空列表时抛错
 */
function filterAndNormalizeProxies(config) {
  regionMatchCache.clear();

  const filterLowRateProxiesEnabled = ruleOptionsEnable.过滤低倍率节点;
  const filterHighRateProxiesEnabled = ruleOptionsEnable.过滤高倍率节点;
  const filterNonRegionProxiesEnabled = ruleOptionsEnable.过滤非地区节点;

  const lowRateRegex = filterLowRateProxiesEnabled
    ? rateRegionDefinitions.find((r) => r.name === lowRateRegionName)?.regex
    : null;
  const highRateRegex = filterHighRateProxiesEnabled
    ? rateRegionDefinitions.find((r) => r.name === highRateRegionName)?.regex
    : null;

  const originalProxies = config.proxies || [];

  const filteredRawProxies = originalProxies.filter((proxy) => {
    const type = String(proxy.type ?? '').toLowerCase();
    if (type === 'direct' || type === 'reject' || type === 'rematch') return false;

    const matchableName = toMatchableName(proxy.name);

    if (lowRateRegex?.test(matchableName) || highRateRegex?.test(matchableName)) return false;

    if (!filterNonRegionProxiesEnabled) return true;

    const isRegionProxy = getMatchedRegions(proxy.name).some((region) => regionDefinitions.includes(region));

    return isRegionProxy || !excludeFilter.test(matchableName);
  });

  const renameMap = new Map();
  const normalizedProxies = [];
  const uniqueNames = new Set();

  for (const rawProxy of filteredRawProxies) {
    const normalized = normalizeProxyName(rawProxy);
    // 与策略组/内置出站/直连节点同名的，改名让路（详见 reservedNames 的注释）
    const name = reserveProxyName(normalized.name, uniqueNames);

    if (name !== rawProxy.name) {
      renameMap.set(rawProxy.name, name);
    }
    if (uniqueNames.has(name)) {
      continue;
    }

    uniqueNames.add(name);
    normalizedProxies.push(name === normalized.name ? normalized : { ...normalized, name });
  }

  const normalizedProxyNames = new Set(normalizedProxies.map((p) => p.name));

  const filteredProxies = normalizedProxies.map((proxy) => fixDialerProxy(proxy, renameMap, normalizedProxyNames));

  if (!filteredProxies.length) {
    throw new Error('配置文件中未找到任何代理节点，请使用机场提供的配置文件进行覆写');
  }

  const ipVersionPreference = getIpVersionPreference();
  if (ipVersionPreference) {
    return filteredProxies.map((proxy) =>
      proxy['ip-version'] === ipVersionPreference ? proxy : { ...proxy, 'ip-version': ipVersionPreference },
    );
  }

  return filteredProxies;
}

// ---构建地区组和倍率组---

/**
 * 构建地区策略组
 *
 * 结构：
 * 地区（select）
 * ├─ 地区-自动选择（url-test）  按延迟挑
 * ├─ 地区-故障转移（fallback）  按顺序兜底
 * └─ 地区下的真实节点
 *
 * 自动选择与故障转移职责分离：
 * - 自动选择：只管从本地区节点里挑延迟低的
 * - 故障转移：只管本地区节点故障时按顺序接管
 *
 * enableFallback=false 时不生成 fallback。倍率组（低/高倍率）走这条路径：
 * 它们是按价格横切出来的集合，与地区组节点高度重叠，再生成一遍 fallback
 * 就是同一批节点被两套定时器反复探活，纯浪费。
 */
function createRegionGroup(name, icon, proxies, enableFallback = true) {
  const generateRegionAutoSelectEnabled = ruleOptionsEnable.生成地区自动选择组;
  const hideManualSelectGroupEnabled = ruleOptionsEnable.隐藏地区手动选择组;

  // 防止空节点组生成无意义的策略组
  if (!proxies || proxies.length === 0) {
    return [];
  }

  const fallbackEnabled = ruleOptionsEnable.故障转移 && enableFallback;
  const fallbackName = `${name}-故障转移`;

  const groups = [];

  // 1. 故障转移
  if (fallbackEnabled) {
    groups.push({
      ...fallbackBaseOption,
      name: fallbackName,
      proxies: [...proxies],
    });
  }

  // 2. 自动选择（只测真实节点，不把故障转移组塞进候选）
  let urlTestName = null;
  if (generateRegionAutoSelectEnabled) {
    urlTestName = `${name}-自动选择`;
    groups.push({
      ...urlTestBaseOption,
      name: urlTestName,
      proxies: [...proxies],
    });
  }

  // 3. 地区手动选择组：自动选择在前，故障转移第二，最后才是裸节点
  groups.push({
    ...selectBaseOption,
    name,
    icon,
    proxies: [...(urlTestName ? [urlTestName] : []), ...(fallbackEnabled ? [fallbackName] : []), ...proxies],
    hidden: hideManualSelectGroupEnabled,
  });

  return groups;
}

/**
 * 将节点按地区/倍率/家宽归类，构建地区、倍率、家宽策略组与“其他节点”组
 */
function buildRegionGroups(filteredProxies, customProxies) {
  const generateRateGroupEnabled = ruleOptionsEnable.生成倍率组;
  const generateHomeGroupEnabled = ruleOptionsEnable.生成家宽节点组;

  const regionGroups = Object.fromEntries(allRegionDefinitions.map(({ name }) => [name, []]));
  const otherProxies = [];

  for (const proxy of [...filteredProxies, ...customProxies]) {
    const matchedRegions = getMatchedRegions(proxy.name);
    const isRegionProxy = matchedRegions.some((region) => regionDefinitions.includes(region));

    for (const region of matchedRegions) {
      regionGroups[region.name].push(proxy.name);
    }

    if (!isRegionProxy) {
      otherProxies.push(proxy.name);
    }
  }

  const generatedRegionGroups = allRegionDefinitions
    .filter(
      (r) =>
        regionGroups[r.name].length > 0 &&
        (generateRateGroupEnabled || !rateRegionDefinitions.includes(r)) &&
        (generateHomeGroupEnabled || !homeRegionDefinitions.includes(r)),
    )
    // 只有真实地区组才生成独立 fallback，倍率组和家宽组都不生成：
    // 家宽节点通常只有一两个、且是「原生 IP 解锁流媒体」这类专用出口，
    // 组内做故障转移没有备胎可选，反而多一组探活。
    .flatMap((r) => createRegionGroup(r.name, r.icon, regionGroups[r.name], regionDefinitions.includes(r)));

  // “其他节点”是跨地区的兜底池，保留 fallback 有意义
  if (otherProxies.length > 0) {
    generatedRegionGroups.push(...createRegionGroup('其他节点', `${iconBaseUrl}WorldMap.svg`, otherProxies));
  }

  return generatedRegionGroups;
}

// ---构建自定义节点组---

/**
 * 处理自定义节点：标准化名称、与订阅节点重名时添加“自建-”前缀、内部去重，
 * 并构建“自建节点”策略组。
 * 自定义节点不参与订阅节点过滤，也不参与 hosts 改写及 DNS 域名处理。
 */
function buildCustomizeGroups(filteredProxies, customizeList = customizeProxies) {
  if (!customizeList.length) {
    return { customProxies: [], customProxyNames: [], customGroup: null };
  }

  // 预订保留名，自定义节点与策略组/内置出站/直连节点重名时同样要加「自建-」前缀让路
  const usedNames = new Set([...filteredProxies.map((p) => p.name), ...reservedNames]);
  const customPrefix = '自建-';
  const customProxies = [];

  for (const proxy of customizeList) {
    const normalized = normalizeProxyName(proxy);
    let name = normalized.name;
    while (usedNames.has(name)) {
      name = normalizeProxyName({ name: `${customPrefix}${name}` }).name.replace(`${customPrefix} `, customPrefix);
    }
    usedNames.add(name);

    customProxies.push(name === normalized.name ? normalized : { ...normalized, name });
  }

  const customProxyNames = customProxies.map((p) => p.name);

  const customGroup = {
    ...selectBaseOption,
    name: '自建节点',
    proxies: customProxyNames,
    icon: `${iconBaseUrl}Server.svg`,
  };

  return {
    customProxies,
    customProxyNames,
    customGroup,
  };
}

// ---构建基础策略组和分流策略组---

/**
 * 构建基础/分流策略组/部分节点组、GLOBAL 组与规则集，并汇总分流规则
 */
function buildFunctionalGroups(filteredProxies, generatedRegionGroups, customizeInfo) {
  const minimalModeEnabled = ruleOptionsEnable.极简模式;
  const blockForeignQuicEnabled = ruleOptionsEnable.屏蔽国外QUIC;
  const addAllNodesToServiceGroupsEnabled = ruleOptionsEnable.分流组添加所有节点;
  const hideManualSelectGroupEnabled = ruleOptionsEnable.隐藏地区手动选择组;

  const functionalGroups = [];
  const functionalRules = [];
  const finalRuleProviders = { ...baseRuleProviders };

  if (!blockForeignQuicEnabled) {
    delete finalRuleProviders.cn_additional;
  }

  const { customProxyNames = [], customGroup = null } = customizeInfo || {};
  const filteredProxyNames = filteredProxies.map((p) => p.name);
  const allProxiesNames = [...filteredProxyNames, ...customProxyNames];
  const groupNamesOfSelect = generatedRegionGroups.filter((g) => g.type === 'select').map((g) => g.name);
  const groupNamesOfFallback = generatedRegionGroups.filter((g) => g.type === 'fallback').map((g) => g.name);
  const baseGroupNames = baseGroups.filter((g) => ruleOptionsEnable[g.name]).map((g) => g.name);
  const customGroupNames = customGroup ? [customGroup.name] : [];

  const defaultFallbackName = '默认代理-故障转移';

  /**
   * 全局故障转移的成员：
   * - 正常模式：各地区-故障转移组。只对「组」做健康检查，探活量等于组数，
   *   而且拿到跨地区降级能力（香港全挂 → 自动跳日本）。
   * - 极简模式 / 地区组未生成：退化为裸节点，保证组不会空掉。
   */
  const globalFallbackMembers = groupNamesOfFallback.length > 0 ? groupNamesOfFallback : allProxiesNames;

  const defaultFallbackGroup =
    ruleOptionsEnable.故障转移 && globalFallbackMembers.length > 0
      ? {
          ...fallbackBaseOption,
          name: defaultFallbackName,
          proxies: [...globalFallbackMembers],
          // 成员是「组」时不必按 fallbackCheckInterval 追：各地区 fallback 已是
          // lazy: false 常测，子组状态本身新鲜，父组再以同样频率复核一遍就是重复轮询。
          // 成员退化成裸节点时（极简模式 / 没有地区组），必须恢复常测。
          lazy: groupNamesOfFallback.length > 0,
          // interval 也必须一起改。本组是「默认代理」的第一个成员，几乎总在链路上、
          // 一直被 touch，lazy 挡不住它；沿用 fallbackBaseOption 的短间隔就等于
          // 每个周期都对子组再打一轮，而子组自己已经在常测。降回 url-test 档的 300s。
          ...(groupNamesOfFallback.length > 0 && { interval: groupBaseOption.interval }),
        }
      : null;

  if (minimalModeEnabled) {
    const defaultAutoSelectName = '默认代理-自动选择';

    const defaultAutoSelectGroup =
      ruleOptionsEnable.自动选择 && allProxiesNames.length > 0
        ? {
            ...urlTestBaseOption,
            name: defaultAutoSelectName,
            proxies: [...allProxiesNames],
            // 极简模式下唯一的测速组，这里必须常测（覆盖 urlTestBaseOption 的 lazy: true）。
            //
            // 原因：lazy 的判定是「最近一个 interval 内有连接经过才测」，lastTouch 只在真实
            // 拨号时刷新。极简模式下用户一旦选了「故障转移」，本组就没有流量经过，从内核启动
            // 测过那一次之后状态彻底冻结。几小时后切回来，url-test 会拿几小时前的延迟选点；
            // 更糟的是它初始化时 fast := proxies[0] 且不检查存活性，第一个节点若已挂
            // （delay 记为 0），后面节点 200 < 0 永不成立，会一直用那个死节点，直到下一轮
            // 探活（最长 300s）才纠正。
            //
            // 代价可控：极简模式只有 2 个非 select 组，本组 300s 一轮，19 节点时 +228 次/小时，
            // 相对故障转移的 1140 次/小时只多 20%。标准模式不做这个覆盖——那里有 7 个测速组，
            // 全部常测会让探活量接近翻倍，而每个地区都有独立 fallback 兜底，不需要手动切。
            lazy: false,
          }
        : null;

    const defaultGroup = {
      ...selectBaseOption,
      name: '默认代理',
      proxies: [
        ...(defaultAutoSelectGroup ? [defaultAutoSelectName] : []),
        ...(defaultFallbackGroup ? [defaultFallbackName] : []),
        ...allProxiesNames,
      ],
      icon: `${iconBaseUrl}Proxy.svg`,
    };

    const directGroup = {
      ...selectBaseOption,
      name: '直连',
      proxies: [...directProxies.map((p) => p.name)],
      icon: `${iconBaseUrl}China.svg`,
      hidden: true,
    };

    const globalGroup = {
      ...selectBaseOption,
      name: 'GLOBAL',
      // 极简模式下只有 默认代理 / 默认代理-自动选择 / 默认代理-故障转移 / 自建 / 直连，
      // 直接全列出来即可。注意别漏掉自动选择和故障转移——原版这里只有「自动选择」，
      // 后来加 fallback 时容易顺手把它挤掉。
      proxies: [
        '默认代理',
        ...customGroupNames,
        ...(defaultAutoSelectGroup ? [defaultAutoSelectName] : []),
        ...(defaultFallbackGroup ? [defaultFallbackName] : []),
        '直连',
      ],
      icon: `${iconBaseUrl}Global.svg`,
    };

    return {
      globalGroup,
      functionalGroups: [
        ...(defaultAutoSelectGroup ? [defaultAutoSelectGroup] : []),
        ...(defaultFallbackGroup ? [defaultFallbackGroup] : []),
        defaultGroup,
      ],
      functionalRules: [],
      finalRuleProviders,
      directGroup,
    };
  }

  // 全局故障转移放最前，默认代理引用它
  if (defaultFallbackGroup) {
    functionalGroups.push(defaultFallbackGroup);
  }

  functionalGroups.push({
    ...selectBaseOption,
    name: '默认代理',
    proxies: [
      ...(defaultFallbackGroup ? [defaultFallbackName] : []),
      ...groupNamesOfSelect,
      ...baseGroupNames,
      ...customGroupNames,
    ],
    icon: `${iconBaseUrl}Proxy.svg`,
  });

  const orderedServiceConfigs = [
    ...serviceConfigs.filter((svc) => svc.name === 'AdBlock'),
    ...serviceConfigs.filter((svc) => svc.name !== 'AdBlock'),
  ];
  for (const svc of orderedServiceConfigs) {
    if (!ruleOptionsEnable[svc.name]) continue;

    functionalRules.push(...(svc.rules || []));
    Object.assign(finalRuleProviders, svc.providers || {});
  }

  for (const svc of serviceConfigs) {
    if (!ruleOptionsEnable[svc.name]) continue;

    let groupProxies = [];
    if (svc.includeAll) {
      groupProxies = [...allProxiesNames];
    } else if (svc.reject) {
      groupProxies = ['REJECT', 'REJECT-DROP', 'PASS'];
    } else {
      // 分流组也要能选到「地区-故障转移」，否则这个组只在地理分组里可见，
      // 用户在 YouTube / Google 里根本挑不到它。
      groupProxies = !addAllNodesToServiceGroupsEnabled
        ? [
            '默认代理',
            ...customGroupNames,
            ...baseGroupNames,
            ...groupNamesOfSelect,
            ...groupNamesOfFallback,
            ...(svc.direct ? ['直连'] : []),
          ]
        : [
            '默认代理',
            ...customGroupNames,
            ...baseGroupNames,
            ...groupNamesOfSelect,
            ...groupNamesOfFallback,
            ...allProxiesNames,
            ...(svc.direct ? ['直连'] : []),
          ];
    }

    // default-selected 指向不存在的目标时，mihomo 不会报错，只会静默退回第一个成员，
    // 但启动日志会刷一串 warning。订阅里没有美国节点时 AI/PayPal/EHentai 就是这种情况。
    // 先在这里校验一遍，目标不存在就不写这个字段，让内核自己取第一个。
    const defaultSelectedValid =
      svc.defaultSelected !== undefined &&
      (groupNamesOfSelect.includes(svc.defaultSelected) ||
        allProxiesNames.includes(svc.defaultSelected) ||
        svc.defaultSelected === '直连');

    functionalGroups.push({
      ...svc.baseOption,
      name: svc.name,
      icon: svc.icon,
      proxies: groupProxies,
      ...(defaultSelectedValid && {
        'default-selected': svc.defaultSelected,
      }),
    });
  }

  functionalGroups.push({
    ...selectBaseOption,
    name: '漏网之鱼',
    proxies: ['默认代理', '直连', ...groupNamesOfSelect, ...groupNamesOfFallback],
    icon: `${iconBaseUrl}Stack.svg`,
  });

  const directGroup = {
    ...selectBaseOption,
    name: '直连',
    proxies: [...directProxies.map((p) => p.name)],
    icon: `${iconBaseUrl}China.svg`,
    hidden: hideManualSelectGroupEnabled,
  };

  const globalGroup = {
    ...selectBaseOption,
    name: 'GLOBAL',
    // 只放「默认代理 + 自建 + 直连 + 各地区手动选择组」，不复刻全部 20 多个分流组。
    // 把 functionalGroups 整个铺进来会让这个组有 39 个成员，客户端里翻不到底，
    // 而 rule 模式下 GLOBAL 本身只在手动切全局模式时才用得到。
    //
    // 这里用 groupNamesOfSelect 而不是 generatedRegionGroups.map(...)：
    // 后者会把「香港-自动选择」「香港-故障转移」这些子组也铺进来，成员数翻三倍，
    // 而这些子组本来就在「香港」组里可选，在 GLOBAL 里再列一遍纯属重复。
    proxies: ['默认代理', ...customGroupNames, directGroup.name, ...groupNamesOfSelect],
    icon: `${iconBaseUrl}Global.svg`,
  };

  return { globalGroup, functionalGroups, functionalRules, finalRuleProviders, directGroup };
}

// ---dns和hosts相关处理---

// 常见的公共 DNS，用于过滤订阅中的公共 DNS
const commonDnsList = [
  // ==================== 国内 ====================

  // 阿里 AliDNS（阿里云）
  '223.5.5.5',
  '223.6.6.6',
  '2400:3200::1',
  '2400:3200:baba::1',
  'alidns',

  // 腾讯 DNSPod（腾讯云）
  '119.29.29.29',
  '182.254.116.116',
  '1.12.12.12',
  '120.53.53.53',
  '2402:4e00::',
  'doh.pub',
  'dot.pub',
  'dns.pub',
  'dnspod',

  // 114DNS（南京信风）
  '114.114.114.114',
  '114.114.115.115',

  // 百度 BaiduDNS
  '180.76.76.76',
  '2400:da00::6666',
  'dns.baidu',

  // CNNIC SDNS（中国互联网络信息中心）
  '1.2.4.8',
  '210.2.4.8',
  '2001:dc7:1000::1',
  'cnnic',

  // 360 安全 DNS
  '101.226.4.6',
  '218.30.118.6',
  '123.125.81.6',
  '2400:8800:1::6',
  '2400:8800:2::6',
  'doh.360',
  'dot.360',

  // 火山引擎（字节跳动）
  '180.184.1.1',
  '180.184.2.2',

  // ==================== 国外 ====================

  // Cloudflare
  '1.1.1.1',
  '1.0.0.1',
  '1.1.1.2',
  '1.0.0.2',
  '1.1.1.3',
  '1.0.0.3',
  '2606:4700:4700::1111',
  '2606:4700:4700::1001',
  '2606:4700:4700::1112',
  '2606:4700:4700::1002',
  '2606:4700:4700::1113',
  '2606:4700:4700::1003',
  'dns.cloudflare',
  'cloudflare-dns',
  'one.one.one.one',

  // Google Public DNS
  '8.8.8.8',
  '8.8.4.4',
  '2001:4860:4860::8888',
  '2001:4860:4860::8844',
  'dns.google',

  // Quad9
  '9.9.9.9',
  '9.9.9.10',
  '9.9.9.11',
  '149.112.112.112',
  '149.112.112.10',
  '149.112.112.11',
  '2620:fe::fe',
  '2620:fe::9',
  'quad9',

  // Cisco OpenDNS（含 FamilyShield）
  '208.67.222.222',
  '208.67.220.220',
  '208.67.222.123',
  '208.67.220.123',
  '2620:119:35::35',
  '2620:119:53::53',
  '2620:119:35::123',
  '2620:119:53::123',
  'opendns',

  // AdGuard DNS（含家庭版）
  '94.140.14.14',
  '94.140.15.15',
  '94.140.14.15',
  '94.140.15.16',
  '2a10:50c0::ad1:ff',
  '2a10:50c0::ad2:ff',
  '2a10:50c0::bad1:ff',
  '2a10:50c0::bad2:ff',
  'adguard',

  // Control D
  '76.76.2.0',
  '76.76.10.0',
  '76.76.19.19',
  '76.223.122.150',
  '2a0d:2a00:1::2',
  '2a0d:2a00:2::2',

  // CleanBrowsing（含安全/家庭版）
  '185.228.168.9',
  '185.228.169.9',
  '185.228.168.10',
  '185.228.169.11',
  '185.228.168.168',
  '185.228.169.168',

  // Yandex DNS
  '77.88.8.8',
  '77.88.8.1',
  '2a02:6b8::feed:0ff',
  '2a02:6b8:0:1::feed:0ff',

  // Neustar UltraDNS
  '156.154.70.1',
  '156.154.71.1',
  '156.154.70.2',
  '156.154.71.2',
  '2610:a1:1018::1',
  '2610:a1:1019::1',

  // Mullvad DNS
  '194.242.2.2',
  '2a07:e340::2',

  // Hurricane Electric
  '74.82.42.42',
  '2001:470:20::2',

  // NextDNS
  'nextdns',

  // Apple
  'dns.apple',
];

// 预编译公共 DNS 正则
const commonDnsRegex = new RegExp(
  commonDnsList.map((dns) => dns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i',
);

// 国内外 DNS 定义
const chinaDNS = ['223.5.5.5#DIRECT', '119.29.29.29#DIRECT'];
const foreignDNS = ['https://cloudflare-dns.com/dns-query#默认代理', 'https://dns.google/dns-query#默认代理'];
const defaultDNS = ['114.114.114.114#DIRECT', 'tls://223.5.5.5#DIRECT', 'https://1.12.12.12/dns-query#DIRECT'];
const proxyServerDNS = ['114.114.114.114#DIRECT', 'tls://223.5.5.5#DIRECT', 'https://doh.pub/dns-query#DIRECT'];

/**
 * hosts 匹配优先级：精确 > +. > . > *（同级按出现顺序）
 */
function hostSpecificity(pattern) {
  if (pattern.startsWith('+.')) return 2;
  if (pattern.startsWith('.')) return 1;
  if (pattern.includes('*')) return 0;
  return 3;
}

/**
 * 判断域名规则（精确/通配）是否匹配节点域名集合，忽略大小写
 */
function matchDomainPattern(pattern, domains) {
  pattern = pattern.toLowerCase();

  // 精确匹配
  if (!pattern.includes('*') && !pattern.startsWith('+.') && !pattern.startsWith('.')) {
    return typeof domains === 'string'
      ? domains.toLowerCase() === pattern
      : [...domains].some((d) => d.toLowerCase() === pattern);
  }

  const domainList = typeof domains === 'string' ? [domains.toLowerCase()] : [...domains].map((d) => d.toLowerCase());

  // +.example.com
  if (pattern.startsWith('+.')) {
    const suffix = pattern.slice(2);
    return domainList.some((domain) => domain === suffix || domain.endsWith(`.${suffix}`));
  }

  // .example.com
  if (pattern.startsWith('.')) {
    const suffix = pattern.slice(1);
    return domainList.some((domain) => domain !== suffix && domain.endsWith(`.${suffix}`));
  }

  // *.example.com、example.*.com 等
  const patternParts = pattern.split('.');
  return domainList.some((domain) => {
    const domainParts = domain.split('.');
    return (
      patternParts.length === domainParts.length &&
      patternParts.every((part, index) => part === '*' || part === domainParts[index])
    );
  });
}

/**
 * 根据订阅 hosts 映射改写节点 server，改写后无需再复制 hosts 进新配置。
 * 支持链式映射（如 a: b、b: c 时节点 a 改写为 c）；
 * 回环映射（a: b、b: a）由内核校验拒绝，此处仅以已访问集合防御性终止
 */
function applyHostsToProxies(proxies, hosts) {
  if (!hosts || typeof hosts !== 'object') return proxies;

  const hostEntries = Object.entries(hosts)
    .filter(
      ([, value]) => (typeof value === 'string' && value.length > 0) || (Array.isArray(value) && value.length > 0),
    )
    .sort((a, b) => hostSpecificity(b[0]) - hostSpecificity(a[0]));

  if (hostEntries.length === 0) return proxies;

  const targetOf = (value) => {
    if (Array.isArray(value)) value = value.find((v) => typeof v === 'string' && v.length > 0);
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  const resolveCache = new Map();
  const resolve = (server) => {
    const cached = resolveCache.get(server);
    if (cached !== undefined) return cached;

    const seen = new Set();
    let current = server.toLowerCase();
    let result = server;
    while (!seen.has(current)) {
      seen.add(current);
      const entry = hostEntries.find(([pattern]) => matchDomainPattern(pattern, current));
      const target = entry && targetOf(entry[1]);
      if (!target) break;
      result = target;
      current = target.toLowerCase();
    }
    resolveCache.set(server, result);
    return result;
  };

  return proxies.map((proxy) => {
    if (typeof proxy.server !== 'string') return proxy;
    const server = resolve(proxy.server);
    return server === proxy.server ? proxy : { ...proxy, server };
  });
}

/**
 * 剥离 DNS 地址的 # 策略组后缀；
 * 参数包含 direct 或 直连 时，强制改为 #DIRECT
 */
function stripDnsSuffix(dns) {
  const str = String(dns);
  const hashIndex = str.indexOf('#');
  if (hashIndex === -1) return str;

  const prefix = str.slice(0, hashIndex).trim();

  const suffix = str
    .slice(hashIndex + 1)
    .toLowerCase()
    .trim();

  if (suffix.includes('direct') || suffix.includes('直连')) return prefix + '#DIRECT';

  return prefix;
}

/**
 * 判断节点 server 是否为 IP 地址（IPv4 / IPv6），用于从节点域名集合中排除 IP 类型的 server
 */
function isIpAddress(server) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(server) || server.includes(':');
}

/**
 * 简化节点域名策略：将相同 DNS 的节点域名按后缀归类，至少三段的域名可合并为 +. 后缀形式
 */
function simplifyDomainPolicy(policy) {
  const groups = new Map();

  for (const [domain, dns] of Object.entries(policy)) {
    const dnsKey = JSON.stringify(Array.isArray(dns) ? [...dns].sort() : dns);

    if (domain.startsWith('+.') || domain.startsWith('.') || domain.includes('*')) {
      groups.set(`keep:${domain}`, [{ domain, dns, dnsKey }]);
      continue;
    }

    const parts = domain.split('.');

    if (parts.length < 3) {
      groups.set(`keep:${domain}`, [{ domain, dns, dnsKey }]);
      continue;
    }

    const suffix = parts.slice(-2).join('.');

    if (!groups.has(suffix)) {
      groups.set(suffix, []);
    }

    groups.get(suffix).push({ domain, dns, dnsKey });
  }

  const result = {};

  for (const [suffix, domains] of groups) {
    const firstDnsKey = domains[0].dnsKey;
    const sameDns = domains.every(({ dnsKey }) => dnsKey === firstDnsKey);

    if (domains.length >= 2 && sameDns) {
      result[`+.${suffix}`] = domains[0].dns;
    } else {
      for (const { domain, dns } of domains) {
        result[domain] = dns;
      }
    }
  }

  return result;
}

/**
 * 构建 DNS 与 hosts：保留私有 DNS、节点域名 policy/fake-ip-filter，并按 hosts 改写节点 server
 * hosts改写条件（满足任意一个条件即可）：
 * 1. proxy-server-nameserver 有且仅有一个 DNS 并且该 DNS 包含非空的 listen 值
 * 2. proxy-server-nameserver 有且仅有一个 DNS 并且该 DNS 包含 127.0.0.1 并且 listen 包含 0.0.0.0
 */
function buildDnsAndHostsConfig(config, filteredProxies) {
  const minimalModeEnabled = ruleOptionsEnable.极简模式;

  const originalDnsConfig = config.dns || {};

  const proxyServerNameservers = originalDnsConfig['proxy-server-nameserver'] || [];
  const listenValue = originalDnsConfig['listen'];

  const shouldRewriteByHosts =
    proxyServerNameservers.length === 1 &&
    typeof listenValue === 'string' &&
    listenValue.length > 0 &&
    (proxyServerNameservers.some((dns) => String(dns).toLowerCase().includes(listenValue.toLowerCase())) ||
      (listenValue.includes('0.0.0.0') &&
        proxyServerNameservers.some((dns) => String(dns).toLowerCase().includes('127.0.0.1'))));

  const mappedProxies = shouldRewriteByHosts ? applyHostsToProxies(filteredProxies, config.hosts) : filteredProxies;

  const proxyDomains = new Set(
    mappedProxies
      .filter((proxy) => typeof proxy.server === 'string')
      .map((proxy) => proxy.server.toLowerCase())
      .filter((server) => !isIpAddress(server)),
  );

  const privateProxyServerNameservers = shouldRewriteByHosts ? [] : proxyServerNameservers;

  const isCommonDns = (dns) => {
    const value = String(dns).trim().toLowerCase();
    if (value === 'system' || value === 'system://') return true;

    return commonDnsRegex.test(value);
  };

  const privateDNS = [
    ...new Set(
      [...(originalDnsConfig['nameserver'] || []), ...privateProxyServerNameservers]
        .map(stripDnsSuffix)
        .filter((dns) => dns.length > 0 && !isCommonDns(dns)),
    ),
  ];

  const matchedProxyPolicy = {};
  for (const [domain, dns] of Object.entries({
    ...originalDnsConfig['nameserver-policy'],
    ...originalDnsConfig['proxy-server-nameserver-policy'],
  })) {
    if (!matchDomainPattern(domain, proxyDomains)) continue;

    const stripedDns = Array.isArray(dns) ? dns.map(stripDnsSuffix).filter((d) => d.length > 0) : stripDnsSuffix(dns);
    if (Array.isArray(stripedDns) && stripedDns.length === 0) continue;

    matchedProxyPolicy[domain] = stripedDns;
  }

  if (privateDNS.length > 0 && Object.keys(matchedProxyPolicy).length === 0) {
    for (const domain of proxyDomains) {
      matchedProxyPolicy[domain] = privateDNS;
    }
  }

  const matchedPolicyDomains = Object.keys(matchedProxyPolicy);
  const proxyServerPolicy =
    proxyDomains.size === matchedPolicyDomains.length &&
    matchedPolicyDomains.every((domain) => proxyDomains.has(domain.toLowerCase()))
      ? simplifyDomainPolicy(matchedProxyPolicy)
      : matchedProxyPolicy;

  const originalFakeIpFilter = originalDnsConfig['fake-ip-filter'] || [];
  const proxyFakeIpFilter = originalFakeIpFilter.filter((pattern) => {
    const p = String(pattern);
    return matchDomainPattern(p, proxyDomains);
  });

  const dns = {
    enable: true,
    ipv6: true,
    'use-hosts': true,
    'cache-algorithm': 'arc',
    'use-system-hosts': true,
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/15',
    'fake-ip-range6': '2001:2::1/48',
    'fake-ip-filter': [
      'rule-set:private',
      'rule-set:fakeip_filter',
      'rule-set:geolocation-cn',
      ...(minimalModeEnabled ? [] : ruleOptionsEnable['FCM'] ? ['rule-set:googlefcm'] : []),
      ...proxyFakeIpFilter,
    ],
    'default-nameserver': defaultDNS,
    'proxy-server-nameserver': proxyServerDNS,
    ...(Object.keys(proxyServerPolicy).length > 0 && {
      'proxy-server-nameserver-policy': proxyServerPolicy,
    }),
    nameserver: foreignDNS,
    'nameserver-policy': {
      'rule-set:private': 'system',
      'rule-set:douyin': ['system', '180.184.1.1', '180.184.2.2'],
      'rule-set:cn': chinaDNS,
    },
    'direct-nameserver': chinaDNS,
    'direct-nameserver-follow-policy': true,
  };

  const hosts = {
    'doh.pub': ['1.12.12.12', '120.53.53.53'],
    'cloudflare-dns.com': ['1.1.1.1', '1.0.0.1'],
    'dns.google': ['8.8.8.8', '8.8.4.4'],

    // 解决谷歌商店无法下载的问题
    'services.googleapis.cn': 'services.googleapis.com',

    // 屏蔽哔哩哔哩PCDN，解决访问视频/直播卡顿问题
    '+.mcdn.bilivideo.com': ['0.0.0.0'],
    '+.mcdn.bilivideo.cn': ['0.0.0.0'],
    '+.edge.mountaintoys.cn': ['0.0.0.0'],
    '+.h2.smtcdns.net': ['0.0.0.0'],
  };

  return { dns, hosts, proxies: mappedProxies };
}

// --- 主入口 ---

/**
 * 主入口：覆写机场订阅配置，生成完整 mihomo 配置
 */
function main(config) {
  if (config['proxy-providers'] && Object.keys(config['proxy-providers']).length > 0) {
    throw new Error('配置文件中包含 proxy-providers，请使用机场提供的配置文件进行覆写');
  }

  const newConfig = {};

  const filteredProxies = filterAndNormalizeProxies(config);

  const { customProxies, customProxyNames, customGroup } = buildCustomizeGroups(filteredProxies);

  const generatedRegionGroups = ruleOptionsEnable.极简模式 ? [] : buildRegionGroups(filteredProxies, customProxies);

  const { globalGroup, functionalGroups, functionalRules, finalRuleProviders, directGroup } = buildFunctionalGroups(
    filteredProxies,
    generatedRegionGroups,
    { customProxyNames, customGroup },
  );

  const { dns, hosts, proxies: mappedProxies } = buildDnsAndHostsConfig(config, filteredProxies);

  newConfig['dns'] = dns;
  newConfig['hosts'] = hosts;
  newConfig['mixed-port'] = 7890;
  // allow-lan 开关在文件顶部 allowLan。开着就必须配 authentication，
  // 否则等于把你家/公司 WiFi 下的 7890 端口对所有人敞开，谁扫到都能免费用你的订阅流量。
  newConfig['allow-lan'] = allowLan;
  newConfig['ipv6'] = true;
  newConfig['mode'] = 'rule';
  newConfig['log-level'] = 'info';
  // allow-lan 为 false 时内核固定监听 127.0.0.1:7890，这个字段不参与计算；
  // 写成 127.0.0.1 只是为了让生成的配置文件读起来不产生歧义。
  newConfig['bind-address'] = allowLan ? '*' : '127.0.0.1';
  if (allowLan) {
    // 内核用 strings.Cut(line, ':') 切分，不含冒号的条目会被静默丢弃、认证器变成 nil，
    // 表现就是「密码白设了、端口依然全开」，而且启动日志一个字都不会提。
    // 这种静默降级太危险，宁可让配置生成直接失败。
    const invalidAuth = lanAuthentication.filter((item) => typeof item !== 'string' || !item.includes(':'));
    if (invalidAuth.length > 0) {
      throw new Error(`lanAuthentication 格式错误，应为 '用户名:密码'：${JSON.stringify(invalidAuth)}`);
    }
    newConfig['authentication'] = [...lanAuthentication];
  }
  newConfig['unified-delay'] = true;
  newConfig['tcp-concurrent'] = true;
  newConfig['keep-alive-interval'] = 60;
  newConfig['find-process-mode'] = 'strict';

  newConfig['external-controller'] = '127.0.0.1:9090';
  newConfig['external-ui'] = 'ui';
  newConfig['external-ui-url'] = 'https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip';

  newConfig['profile'] = {
    'store-selected': true,
    'store-fake-ip': true,
  };

  newConfig['ntp'] = {
    enable: true,
    'write-to-system': false,
    server: 'ntp.aliyun.com',
    port: 123,
    interval: 60,
  };

  newConfig['tun'] = {
    enable: true,
    // 原脚本这里写的是 'mips'，不是合法值。mihomo 只认 system / gvisor / mixed，
    // 非法值会被静默回落到 gvisor，行为上没炸，但等于你以为自己在用某个栈、其实不是。
    // gvisor：用户态，最稳，兼容性最好。
    // mixed ：TCP 走系统栈、UDP 走 gvisor，性能更好，个别机型会出问题，想压性能就换它。
    stack: 'gvisor',
    'auto-route': true,
    'strict-route': true,
    'auto-redirect': true,
    'auto-detect-interface': true,
    'dns-hijack': ['any:53', 'tcp://any:53'],
  };

  newConfig['proxies'] = [...mappedProxies, ...customProxies, ...directProxies];
  newConfig['proxy-groups'] = [
    globalGroup,
    ...functionalGroups,
    ...(customGroup ? [customGroup] : []),
    directGroup,
    ...generatedRegionGroups,
  ];
  newConfig['rule-providers'] = finalRuleProviders;

  newConfig['rules'] = [
    ...prefixRules,
    ...(ruleOptionsEnable.屏蔽国外QUIC ? blockForeignQuic : []),
    ...functionalRules,

    // 兜底规则
    'RULE-SET,geolocation-!cn,默认代理',
    'RULE-SET,cn_ip,直连',
    'RULE-SET,private_ip,直连',
    `MATCH,${ruleOptionsEnable.极简模式 ? '默认代理' : '漏网之鱼'}`,
  ];

  return newConfig;
}
