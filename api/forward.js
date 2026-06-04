import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
    // 1. 检查环境变量是否配置完整
    const config = {
        sourceUser: process.env.SOURCE_USER,       // 原邮箱账号
        sourcePass: process.env.SOURCE_PASS,       // 原邮箱授权码
        sourceHost: process.env.SOURCE_IMAP_HOST,  // 原邮箱 IMAP 地址 (如 imap.qq.com)
        smtpHost: process.env.TARGET_SMTP_HOST,    // 用于转发的发信服务器 (如 smtp.qq.com)
        smtpPort: process.env.TARGET_SMTP_PORT || 465,
        targetUser: process.env.TARGET_USER,       // 接收转发的目标邮箱
    };

    if (!config.sourceUser || !config.sourcePass || !config.targetUser) {
        return res.status(500).json({ error: '环境变量未配置完整' });
    }

    // 2. 初始化 IMAP 客户端 (收信)
    const imapClient = new ImapFlow({
        host: config.sourceHost,
        port: 993,
        secure: true,
        auth: { user: config.sourceUser, pass: config.sourcePass },
        logger: false
    });

    // 3. 初始化 SMTP 客户端 (发信)
    // 这里使用原邮箱的身份把信发出，投递到目标邮箱
    const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: parseInt(config.smtpPort),
        secure: true,
        auth: { user: config.sourceUser, pass: config.sourcePass }
    });

    try {
        await imapClient.connect();
        // 获取 INBOX 的锁，确保读写安全
        let lock = await imapClient.getMailboxLock('INBOX');
        
        // 🔍 核心：只搜索未读邮件 (UNSEEN)
        let messages = await imapClient.search({ unseen: true });
        let forwardCount = 0;

        if (messages.length > 0) {
            // 逐封处理未读邮件
            for (let uid of messages) {
                // 抓取邮件的完整内容 (source)
                let { content } = await imapClient.download(uid);
                
                // 抓取邮件基本信息用于日志
                let [meta] = await imapClient.fetch(uid, { envelope: true });
                const subject = meta.envelope.subject || '(无主题)';

                // 🚀 执行转发：直接将原邮件流式转发给目标邮箱，保留原格式
                await transporter.sendMail({
                    from: config.sourceUser,
                    to: config.targetUser,
                    subject: `[转发] ${subject}`,
                    html: content // 直接传入原邮件的 buffer/stream
                });

                // ✅ 成功后，将原邮件标记为已读 (\Seen)，防止下次重复转发
                await imapClient.messageFlagsAdd(uid, ['\\Seen']);
                forwardCount++;
            }
        }

        lock.release();
        await imapClient.logout();

        return res.status(200).json({ 
            success: true, 
            message: `检查完毕。发现并成功转发了 ${forwardCount} 封新邮件。` 
        });

    } catch (err) {
        if (imapClient) await imapClient.logout().catch(() => {});
        return res.status(500).json({ success: false, error: err.message });
    }
}
