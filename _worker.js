export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            const path = url.pathname;
            const jsonHeaders = { "Content-Type": "application/json" };

            // 驗證輔助函式
            async function verifyAuth() {
                const authHeader = request.headers.get('Authorization');
                if (!authHeader || !authHeader.startsWith('Basic ')) return null;
                const base64str = authHeader.substring(6);
                const decoded = atob(base64str);
                const [username, password] = decoded.split(':');
                if (!username || !password) return null;
                
                const stored = await env.NOTE_KV.get(`user:${username}`, { type: "json" });
                if (stored && stored.password === password) return username;
                return null;
            }

            // ==========================
            // 1. API: 註冊帳號 (帶數量限制)
            // ==========================
            if (path === '/api/register' && request.method === 'POST') {
                if (!env.NOTE_KV) throw new Error("嚴重錯誤：後台尚未綁定 NOTE_KV 儲存！");
                
                const bodyText = await request.text();
                const body = JSON.parse(bodyText);
                const username = body.username;
                const password = body.password;
                
                if (!username || !password) {
                    return new Response(JSON.stringify({ success: false, message: "帳號或密碼為空" }), { status: 400, headers: jsonHeaders });
                }

                // 限制註冊人數
                const maxUsers = env.MAX_USERS ? parseInt(env.MAX_USERS, 10) : 1; 
                const userList = await env.NOTE_KV.list({ prefix: 'user:' });
                
                if (userList.keys.length >= maxUsers) {
                    return new Response(JSON.stringify({ 
                        success: false, 
                        message: `私有雲限制：當前系統最多僅允許註冊 ${maxUsers} 個帳號` 
                    }), { status: 403, headers: jsonHeaders });
                }

                const existing = await env.NOTE_KV.get(`user:${username}`);
                if (existing) {
                    return new Response(JSON.stringify({ success: false, message: "該帳號已被註冊" }), { status: 400, headers: jsonHeaders });
                }

                await env.NOTE_KV.put(`user:${username}`, JSON.stringify({ password }));
                await env.NOTE_KV.put(`data:${username}`, JSON.stringify({}));
                
                return new Response(JSON.stringify({ success: true, message: "註冊成功" }), { status: 200, headers: jsonHeaders });
            }

            // ==========================
            // // 2. API: 登入帳號
            // ==========================
            if (path === '/api/login' && request.method === 'POST') {
                if (!env.NOTE_KV) throw new Error("嚴重錯誤：後台尚未綁定 NOTE_KV 儲存！");
                const bodyText = await request.text();
                const body = JSON.parse(bodyText);
                
                const stored = await env.NOTE_KV.get(`user:${body.username}`, { type: "json" });
                if (!stored || stored.password !== body.password) {
                    return new Response(JSON.stringify({ success: false, message: "帳號或密碼錯誤" }), { status: 401, headers: jsonHeaders });
                }
                return new Response(JSON.stringify({ success: true, message: "登入成功" }), { status: 200, headers: jsonHeaders });
            }

            //==========================
            // 3. API: 雲端資料同步
            // ==========================
            if (path === '/api/sync') {
                if (!env.NOTE_KV) throw new Error("嚴重錯誤：後台尚未綁定 NOTE_KV 儲存！");
                const username = await verifyAuth();
                if (!username) return new Response(JSON.stringify({ message: "未授權" }), {status: 401, headers: jsonHeaders });

                if (request.method === 'GET') {
                    let data = await env.NOTE_KV.get(`data:${username}`);
                    return new Response(data || "{}", { status: 200, headers: jsonHeaders });
                }
                
                if (request.method === 'POST') {
                    const data = await request.text();
                    await env.NOTE_KV.put(`data:${username}`, data);
                    return new Response(JSON.stringify({ success: true }), {status: 200, headers: jsonHeaders });
                }
            }

            // ==========================
            // // 4. API: 帳號註銷 (徹底清空資料)
            // ==========================
            if (path === '/api/delete-account' && request.method === 'POST') {
                if (!env.NOTE_KV) throw new Error("嚴重錯誤：後台尚未綁定 NOTE_KV 儲存！");
                const username = await verifyAuth();
                if (!username) return new Response(JSON.stringify({ success: false, message: "未授權" }), { status: 401,headers: jsonHeaders });

                // 刪除對應帳號的所有資料，包括登入憑證和筆記
                await env.NOTE_KV.delete(`data:${username}`);
                await env.NOTE_KV.delete(`user:${username}`);

                return new Response(JSON.stringify({ success: true, message: "帳號及資料已徹底銷毀" }), { status: 200, headers: jsonHeaders });
            }

            // ==========================
            // 5. 靜態網頁託管
            // ==========================
            if (!env.ASSETS) {
                throw new Error("雲端組件丟失：ASSETS物件不存在，無法渲染 index.html。");
            }
            
            const assetResponse = await env.ASSETS.fetch(request);
            if (assetResponse.status === 404 && path === '/'){
                throw new Error("404 錯誤：系統找不到 index.html。請檢查 index.html 和 _worker.js 是否都在程式碼專案的最外層根目錄！");
            }
            return assetResponse;
        
        } catch (err) {
                return new Response(`🚨 網頁崩潰日誌 🚨\n\n錯誤訊息: ${err.message}\n\n堆疊追蹤:\n${err.stack}`, {status: 500, 
                    headers: { "Content-Type": "text/plain;charset=UTF-8" } 
                });
        }   
    }
};
