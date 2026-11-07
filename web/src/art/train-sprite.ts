// The monorail train in three cars (rear, middle, front locomotive), cut at the couplers from
// Ardian's ChatGPT train images (docs/art-source/train.png, train-night.png; see docs/ASSETS.md)
// after tools/pixelize/cutout.py (8 rows for laptops, 4 for phones). Generated: do not edit by hand.

export interface TrainCars {
  palette: Record<string, string>;
  rear: string[];
  mid: string[];
  front: string[];
}

export const TRAIN_CARS: Record<'hd_day' | 'hd_night' | 'sd_day' | 'sd_night', TrainCars> = {
  hd_day: {
    palette: {"a": "#010C19", "b": "#00EC97", "c": "#8CA4B7", "d": "#F0F5F4", "e": "#DEEBEB", "f": "#DBE8E9", "g": "#496B87", "h": "#2A4362", "i": "#142D47", "j": "#213B59", "k": "#02F1FA", "l": "#00BEED", "m": "#02A2D7", "n": "#57FBFC", "o": "#67FBFC", "p": "#224464", "q": "#2B4A6A", "r": "#AAC8CD", "s": "#06F47A", "t": "#00D477", "u": "#115F78", "v": "#04F6EB", "w": "#8CF8F9", "x": "#C1D5DA"},
    rear: [".....aaba...........aaa.....", "..cddeeeefeffddeeeedeeedddgh", ".aiijiklmkmljlnhlojmalljjdpj", ".bpjjmlmkllkhnkhomhomkljhdqq", "reeeddddddddddddddddddddddmq", "lsttttssssssstttttttssstsska", "cfffeerrrreereeeeereereefcjj", "ijiiuvvjijjhjjjjjhjuvvvjiiaa"],
    mid: ["..aaaa.........aaaa....", "ddddefeefeeeedffeedddfq", "djmohlohlohlmilllklahrq", "dlnkjokhnlklmkllklokjrm", "dddddddddddddddddddddcm", "sttsttttttttssstssttstm", "freeeeeeerreerreeerffcq", "ihpvpvjihjhhjhjuvvvjiia"],
    front: [".avaa........aaa...........", "cddeeeeeeffffffeddgca......", "rdhmahmwjloqlamjheeqlka....", "fjmlkjokhnkhmmkikqjedklkk..", "adddddddddddddddddddeeedgq.", "atssttttstttssstssssskejfxa", "cefeedeeeeefeeeeeexreffxxfa", "ajjpuvvjhhhijidvvhiiiiija.."],
  },
  hd_night: {
    palette: {"a": "#010D18", "b": "#E2FBF7", "c": "#03F9C1", "d": "#B1D3E0", "e": "#B6DFE4", "f": "#222F2C", "g": "#FEFCBC", "h": "#FDF671", "i": "#F8C002", "j": "#FEF86B", "k": "#FBC502", "l": "#FCE908", "m": "#1A3854", "n": "#1F83AE", "o": "#BCEDE8", "p": "#01F894", "q": "#09F5B1", "r": "#5DF8FC", "s": "#156975", "t": "#21FAFB", "u": "#94771A", "v": "#00EC97", "w": "#97BA99"},
    rear: ["......abca...........abba...", "...dddddddddddddddddededdeba", "..ffffghifjgkgllfjgklllffmda", ".klmmijkhfgklllhfbkllkhfifma", "nddooooaooaoooaoooboooaoooma", "npppppppppppppppppppppppppqa", "frrrrnrrrnmrrrrrrrrmrrnrrrsa", "fmfmtttmammmmmmmmmmmttttmmmf"],
    mid: ["....asba.........asbq..", "saedddddddddddddddeddeb", "tadiliflhfjglhlifllflhm", "camkkllklugljlklkklfgla", "tabboooooooooooooooooom", "tappppppppppppppppppppp", "marnmrrrmrnrrrmnrrrrrrs", "fmmmttttmmmmmmmmattttmm"],
    front: ["....abba.......aqbc........", "basneeeddddddddddeebbia....", "damdalhijliflgukjifddukg...", "eandfkkllllfglkkkifmmdbll..", "banfmooooaafaaoooooomboobna", "panvpvpppppppppppppppppttsd", "mamnmrrrrrrrnrrrrrrrddwrrns", "maffmmttttmmmmmmttttmmfmm.."],
  },
  sd_day: {
    palette: {"a": "#F8FAF9", "b": "#FAFBFA", "c": "#254767", "d": "#00CFD0", "e": "#223A58", "f": "#01B6E9", "g": "#04F6EA", "h": "#01B6E8", "i": "#00B2E8", "j": "#030C1B", "k": "#F4F7F7", "l": "#2A4D6F", "m": "#E6EDEC", "n": "#1788A6", "o": "#132E48", "p": "#A2C2C9", "q": "#AAC5CC", "r": "#26415F", "s": "#66FBFC", "t": "#22D3EE", "u": "#04F6E9", "v": "#08F67C", "w": "#8BA6B8"},
    rear: ["..ababaaaabbac", ".defcfgfhifjkl", "mmkbabbbbbbban", "oepqeeeereqeco"],
    mid: ["aabbbbbabaaj", "estgffffcfkm", "aabbbabbbaac", "rqueeecegeoj"],
    front: ["babbbbbbb....", "esfhfcicmmt..", "abbabbaaavmkw", "cqgeeeuocqwwj"],
  },
  sd_night: {
    palette: {"a": "#FAFCFC", "b": "#B5D5E1", "c": "#B6DBE3", "d": "#FBE903", "e": "#1A3653", "f": "#FDFBAD", "g": "#FDF241", "h": "#474729", "i": "#FBCC02", "j": "#FDE406", "k": "#01F796", "l": "#01F898", "m": "#04FAFA", "n": "#1D3B5A", "o": "#061727", "p": "#04F9F8", "q": "#DBF1F4", "r": "#264464", "s": "#406485", "t": "#254667", "u": "#99C0D5"},
    rear: ["..abbbbbcabcaa", ".defdghagijjib", "cklllkkkkklkla", "eemmneeeenmmno"],
    mid: ["oabbabbcbcba", "ooijdghdiddb", "pqklkklkkkla", "oemmenerrmmr"],
    front: ["oaaabbbbaa...", "sbddijdgibid.", "plqlklkkqllqs", "otmmeremmreuo"],
  },
};
