from services.portrait_service import crop_portrait


input_image = r"D:\cmnd\BE\tmp_uploads\cccd_test.jpg"
output_image = r"D:\cmnd\BE\tmp_uploads\portrait_test.jpg"


result = crop_portrait(
    input_image,
    output_image
)

print("Kết quả:")
print(result)