// The monorail train in two cars (rear, front), cut from Ardian's ChatGPT train images
// (docs/art-source/train.png, train-night.png; see docs/ASSETS.md) after tools/pixelize/cutout.py.
// `hd` = laptop (2 pixels per game pixel), `sd` = phones. Generated: do not edit by hand.

export interface TrainCars {
  palette: Record<string, string>;
  rear: string[];
  front: string[];
}

export const TRAIN_CARS: Record<'hd_day' | 'hd_night' | 'sd_day' | 'sd_night', TrainCars> = {
  hd_day: {
    palette: {"a": "#D9E8E8", "b": "#0BF5BB", "c": "#B2CAD2", "d": "#00EC97", "e": "#091E35", "f": "#FAFBFB", "g": "#8AAFBD", "h": "#3B5B7A", "i": "#659AAB", "j": "#000712", "k": "#E9F2F2", "l": "#DEEAEA", "m": "#01C6C8", "n": "#115F7B", "o": "#223C5B", "p": "#0397C5", "q": "#04EBF8", "r": "#00B3E8", "s": "#294564", "t": "#7CFAFB", "u": "#4FFAFB", "v": "#15314C", "w": "#00CF7B", "x": "#00D376"},
    rear: ["........abbb...............cdbde......", "....ffffggghfffffffffffffffigihffffejj", "...gkkklllllllllaalllllllllllllllllihj", "..mbnnopqrrrsrrtsqrursrrtsrrtrrsookano", ".pddborprqrqsrtqsrurrertrsrtrrqjmsfaqh", "jskokvoouqqqsurqourqqsqqqotqqqrssooaqh", "ikkkkkkffffffffffffffffffffffffffffgpj", "wxxxxxxxxxxxxdxdwwwwxxxxxxxxwxwxxxxxpj", "jaaaalkklkkklkkkkklllllkkkkkkklkklkihs", "esssoveeevoooooooovooosseovvvpvohsseov", ".vejvjjnjjojvvjvvvvvvvvvvvjjjjjjjje.jj"],
    front: ["...kbbd...........jbbbg...............", "jjfccihffffffffffffggghffjoj..........", "sikklllllllllaaalaaalllllfhihsj.......", "qckoppupsrrrsqrteerrqrvsellhrqqaj.....", "blkopurqrrtqsrureerurqvqssllfhqqqq....", "qafoqrqqerqqserqeeuqqqsssssvllssrprj..", "qcffffffffffffffffffffffffffklkkkklcj.", "qjxxxxxxxxxxxxxxxddxwxxxxxxddddxooaacj", "njkklkkkkkkkkkklkkkkkkllllllllaavqvabj", "ejsssvpepvsoovoooosspvvpsscccgggggggh.", "j.vvvjnjjnvjvvvvvvjvjjjjjjvvvvvvvjj..."],
  },
  hd_night: {
    palette: {"a": "#04131F", "b": "#03FAEF", "c": "#F9FCFB", "d": "#00EC97", "e": "#357EA8", "f": "#1F3037", "g": "#286C90", "h": "#1A3A56", "i": "#B7D4E0", "j": "#B9EDE7", "k": "#FDFA76", "l": "#48503E", "m": "#F9B402", "n": "#E2ECCC", "o": "#FCEF15", "p": "#FAD002", "q": "#8DB7CE", "r": "#98670A", "s": "#A1EFED", "t": "#C7F6EF", "u": "#03D88D", "v": "#2FF7EF", "w": "#15FBFC"},
    rear: ["........abccd................dccda....", "....ecccfegfeccccccccccccccccehhfcccca", "...giiiiiifiiiiiiiiiiiiiiiifiiiiiiijjh", "..aklahmnoknofkoolnkcplnkcplponpflhhie", ".ankmhfmnkpkookpnlkcoklknpolonoofomhfq", "aeqqqhhfprpoafknohcokolnpoahopomhhhhhq", "essstsdtttttdtttttttjjjttttttttttjscce", "udddddddddddduuudduudddddddddddddddddg", "eccvcccccccvvcvvvvvvvvvvvvccccccccccce", "fhhhhbwbbbhhhhhhhhhhhhhhhfhhbbbbbhhhhf", ".fffhbbbbwhafffffffffffhffafwwbbwhfffa"],
    front: [".......dccda..........adccb...........", "ccaahacqfhhcccccccgcccceehqtaaa.......", "jjaggejiiiiiiifiiiiiiiiiiiiiilmma.....", "hiegheilopkrkonmlkonmlpkomlhiilpoc....", "hiqbgealokpoonpolonpoloppmflhiickkoa..", "hhqbgehhopohlprolnmoalompahhhhijcrppa.", "tcabgactttjtttttttttttjtjjttcccdjtccqa", "ddgbggdduddddddddddddddddddddddddhbbsa", "ccaegecccccvccvcvccvvccccccscsssssbbva", "hhfhhfhhhwbbbbhhhhhhhhhbbbbbhqqqqqeeh.", "ff.ff.hfhwbwbbhfffffhffbwbwbhffffaf..."],
  },
  sd_day: {
    palette: {"a": "#FBFCFB", "b": "#86ABBB", "c": "#010C1C", "d": "#1D3652", "e": "#00B4E9", "f": "#284464", "g": "#233B59", "h": "#00A8D9", "i": "#254868", "j": "#E8EFEE", "k": "#294665", "l": "#02EEFA", "m": "#0A1F38", "n": "#04F8FA", "o": "#03F8F6", "p": "#07F77B", "q": "#2B4766", "r": "#05F8EA", "s": "#284262", "t": "#01C9F3", "u": "#C5D4DA"},
    rear: ["..aabaaaaaaaccaa.", ".dddefegegegheggi", "bjjgekelefelmlfgj", "ennnnnnnnnnonpnpc", "mqmrdgggggggrrgkc"],
    front: [".ccaaaaacba......", "jscgmdmqehkjin...", "agnsnmlqntkqjjlq.", "nnnnnpnnpnpnpnjju", "mqirggggsrofdddb."],
  },
  sd_night: {
    palette: {"a": "#F9FCFC", "b": "#0E364A", "c": "#132D41", "d": "#F4F9FA", "e": "#061622", "f": "#3E6385", "g": "#FCE815", "h": "#FAD101", "i": "#FDFA99", "j": "#47482F", "k": "#1A364F", "l": "#C6DFE8", "m": "#313C31", "n": "#224664", "o": "#02F9FB", "p": "#01F795", "q": "#1D3853", "r": "#03F9EA", "s": "#01F896", "t": "#709EBC"},
    rear: ["..aabcdedfdadfaaa", ".cccghghidjicghkl", "clkkhgdeeimebeekn", "ooppppoopoooppppo", "cqoooqqqqqqnqooqn"],
    front: ["e.aaqaaaeabbe....", "lnlghgmjgcmmlgg..", "brkegegcgceknllg.", "ooooosppssosssooo", "qcnqooqnqqoonctt."],
  },
};
