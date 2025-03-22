import { requestUrl } from 'obsidian';

const apiUrl = "https://www.yuque.com/api/upload/attach";
const file = "./1234.png"

const formData = new FormData();
const arrayBuffer = await this.app.vault.readBinary(file);
const blob = new Blob([arrayBuffer], { type: "image/png" }); // 这里假设是 PNG 图片
formData.append("file", blob, file.name);  // 确保提供文件名
const response = await requestUrl({
    url: apiUrl,
    method: "POST",
    headers: {
        'Content-Type': 'multipart/form-data; boundary=--------------------------255533913370571804669949',
        'Cookie': this.yuqueCookie,
        'Referer': 'https://www.yuque.com',
        'Origin': 'https://www.yuque.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
    },
    body: formData
});
if (response.status === 200) {
    const result = await response.json();
    console.log(result);
} else {
    console.error("上传失败:", response.status);
    console.error("上传失败:", response.text);
}