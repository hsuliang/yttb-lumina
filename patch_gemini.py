import re

with open('public/js/gemini-api.js', 'r') as f:
    content = f.read()

# For callGeminiAPI
search_stream_1 = """                if (onStream && !forceJson) {
                    const result = await model.generateContentStream(prompt, requestOptions);
                    for await (const chunk of result.stream) {"""

replace_stream_1 = """                if (onStream && !forceJson) {
                    onStream('', `${modelName} 模型思考中...`);
                    const result = await model.generateContentStream(prompt, requestOptions);
                    for await (const chunk of result.stream) {"""
content = content.replace(search_stream_1, replace_stream_1)

# For callGeminiAudioAPI
search_stream_2 = """                if (onStream) {
                    const result = await model.generateContentStream({ contents: [{ role: "user", parts }] }, requestOptions);
                    for await (const chunk of result.stream) {"""

replace_stream_2 = """                if (onStream) {
                    onStream('', `${modelName} 模型思考中...`);
                    const result = await model.generateContentStream({ contents: [{ role: "user", parts }] }, requestOptions);
                    for await (const chunk of result.stream) {"""
content = content.replace(search_stream_2, replace_stream_2)

with open('public/js/gemini-api.js', 'w') as f:
    f.write(content)
