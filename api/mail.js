import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
    // 允许跨域（本地测试用）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(455).json({ error: '仅支持 POST 请求' });
    }

    const { action, imapHost, imapPort, smtpHost, smtpPort, username, password, to, subject, body } = req.body;

    // ---- 📥 动作一：读取收件箱 (IMAP) ----
    if (action === 'fetch') {
        const client = new ImapFlow({
            host: imapHost,
            port: parseInt(imapPort) || 993,
            secure: true,
            auth: { user: username, pass: password },
            logger: false
        });

        try {
            await client.connect();
            let lock = await client.getMailboxLock('INBOX');
            
            // 获取最近的 10 封邮件
            let emails = [];
            let list = await client.fetch({ seq: `${Math.max(1, client.mailbox.exists - 9)}:*` }, { envelope: true });
            
            for await (let item of list) {
                emails.push({
                    uid: item.uid,
                    subject: item.envelope.subject || '(无主题)',
                    from: item.envelope.from.map(f => `${f.name || ''} <${f.address}>`).join(', '),
                    date: item.envelope.date
                });
            }
            
            // 倒序排列，最新的在前面
            emails.reverse();

            lock.release();
            await client.logout();
            return res.status(200).json({ success: true, emails });
        } catch (err) {
            return res.status(500).json({ success: false, error: 'IMAP 错误: ' + err.message });
        }
    }

    // ---- 📤 动作二：发送邮件 (SMTP) ----
    if (action === 'send') {
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort) || 465,
            secure: true, 
            auth: { user: username, pass: password },
        });

        try {
            await transporter.sendMail({
                from: username,
                to,
                subject,
                text: body,
            });
            return res.status(200).json({ success: true, message: '邮件发送成功！' });
        } catch (err) {
            return res.status(500).json({ success: false, error: 'SMTP 错误: ' + err.message });
        }
    }

    return res.status(400).json({ error: '未知的 action' });
}