// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ChainArchive {
    struct ArchiveRecord {
        string url;
        string cid;
        address archiver;
        uint256 timestamp;
    }

    // Her arşiv kaydına erişmek için ID kullanıyoruz
    mapping(uint256 => ArchiveRecord) public archives;
    uint256 public nextArchiveId;

    // Arayüzün dinleyebilmesi için bir Olay (Event) fırlatıyoruz
    event ArchiveCreated(
        uint256 indexed archiveId,
        string url,
        string cid,
        address indexed archiver,
        uint256 timestamp
    );

    /**
     * @dev Yeni bir arşiv kaydı oluşturur.
     * @param _url Arşivlenen sayfanın orijinal URL'si.
     * @param _cid IPFS üzerindeki Hash / Content Identifier değeri.
     */
    function createArchive(string memory _url, string memory _cid) public {
        uint256 archiveId = nextArchiveId++;
        
        archives[archiveId] = ArchiveRecord({
            url: _url,
            cid: _cid,
            archiver: msg.sender,
            timestamp: block.timestamp
        });

        emit ArchiveCreated(archiveId, _url, _cid, msg.sender, block.timestamp);
    }

    /**
     * @dev ID'si verilen arşiv kaydını döndürür.
     */
    function getArchive(uint256 _archiveId) public view returns (
        string memory url,
        string memory cid,
        address archiver,
        uint256 timestamp
    ) {
        require(_archiveId < nextArchiveId, "Arsiv bulunamadi.");
        ArchiveRecord memory record = archives[_archiveId];
        return (record.url, record.cid, record.archiver, record.timestamp);
    }
}
