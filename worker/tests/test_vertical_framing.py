"""Enquadramento vertical: vídeos 9:16 preenchem a tela; horizontais ganham faixas pretas."""
import pytest

from clip_factory.render import vertical_video_filter


@pytest.mark.parametrize("dims", [(1080, 1920), (720, 1280), (1080, 1918), (1440, 2560)])
def test_vertical_videos_fill_the_screen(dims):
    vf = vertical_video_filter(dims)
    assert "crop=1080:1920" in vf and "pad=" not in vf


@pytest.mark.parametrize("dims", [(1920, 1080), (1280, 720), (1080, 1080), (1080, 1350), (3840, 2160)])
def test_horizontal_and_square_videos_get_black_bars(dims):
    vf = vertical_video_filter(dims)
    assert "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black" in vf
    assert "crop=" not in vf


def test_unknown_dimensions_never_crop():
    # Sem saber o tamanho, é mais seguro não cortar nada do vídeo.
    assert "pad=" in vertical_video_filter(None)
