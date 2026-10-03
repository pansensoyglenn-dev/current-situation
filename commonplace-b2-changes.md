[
  {
    "corsRuleName": "commonplace-video",
    "allowedOrigins": ["https://current-situation.vercel.app"],
    "allowedOperations": ["s3_put", "s3_get", "s3_head", "b2_download_file_by_name"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3600
  }
]
