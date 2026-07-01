import sys
from pathlib import Path
import torch

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parent
sys.path.insert(0, str(WORKSPACE / 'kodachrome_film_nn'))
from kodachrome_net import KodachromeNet

checkpoint = WORKSPACE / 'kodachrome_film_nn' / 'checkpoints' / 'kodachrome_latest.pt'
out = HERE / 'models' / 'kodachrome_latest.onnx'
ckpt = torch.load(checkpoint, map_location='cpu')
model = KodachromeNet().cpu().eval()
model.load_state_dict(ckpt['model'])
dummy = torch.rand(1, 3, 256, 256, dtype=torch.float32)
torch.onnx.export(
    model,
    dummy,
    out,
    input_names=['image'],
    output_names=['filtered'],
    opset_version=17,
    dynamic_axes={'image': {2: 'height', 3: 'width'}, 'filtered': {2: 'height', 3: 'width'}},
    external_data=False,
)
print(out.resolve())
