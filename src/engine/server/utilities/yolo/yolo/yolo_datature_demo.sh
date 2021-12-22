#!/bin/sh

# For Datature Demo
# All the parameters are fixed except for the model path and classes directory.
# So all that is done here is take in the model path,
# Then run yolo.py with all other parameters fixed.

echo Please input full model directory.

read model_dir

echo Please input full labels directory.

read label_dir

echo Initiating yolo.py...

python3 yolo.py \
    --model_type=yolo4_mobilenet_lite \
    --weights_path=$model_dir \
    --anchors_path=configs/yolo4_anchors.txt \
    --classes_path=$label_dir \
    --model_input_shape=320x320 \
    --image